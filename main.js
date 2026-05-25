
// ─── Arcane Spell Engine ──────────────────────────────────────────────────────
// Manages the mana economy for a running spell.
// The interpreter runs the spell script; the engine enforces the rules.
// Scripts express intent — the engine handles consequences.

// ═══════════════════════════════════════════════════════
//  SPELL ENGINE - MANA ECONOMY AND SPELL LIFECYCLE
// ═══════════════════════════════════════════════════════

/**
 * Mana cost configuration for spell components
 */
const SPELL_COSTS = Object.freeze({
    shape: Object.freeze({
        ball: 10,
        cone: 15,
        beam: 12,
        nova: 20,
        wall: 18,
    }),
    attribute: Object.freeze({
        fire: 10,
        light: 8,
        ice: 9,
        shadow: 12,
        arcane: 7,
        void: 15,
    }),
    speedPerUnit: 2,           // mana drained per second per unit of speed
    speedFollowMult: 0.5,      // follow spells use half (no kinetic energy cost)
    sizePerUnit: 3,            // upfront cost per size unit above 1
    nestSurcharge: 0.10,       // sub-spell nesting surcharge per level
})

/**
 * SpellEngine - Manages the mana economy and lifecycle for a running spell.
 * The interpreter runs the spell script; the engine enforces the rules.
 * Scripts express intent — the engine handles consequences.
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
        // Maps scroll name → script source string.
        // In the full game this would be the player's scroll inventory.
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
     * Surcharge is engine-enforced; player cannot change it
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

    /**
     * Spend mana from the budget
     * @private
     */
    _spend(cost, label) {
        const free = this.mana - this.reserved
        if (cost > free) {
            return this._err(`not enough mana for ${label} — need ${cost}, free ${Math.round(free)}`)
        }
        this.mana -= cost
        this.upfront += cost
        return true
    }

    /**
     * Check if spell is active (currently always returns true)
     * @private
     */
    _requireActive(name) {
        return true
    }

    /**
     * Calculate nesting surcharge multiplier
     * @private
     */
    _nestSurcharge() {
        return 1 + SPELL_COSTS.nestSurcharge * this.nestDepth
    }

    /**
     * End the spell lifecycle
     * @private
     */
    _kill() {
        this.phase = 'dead'
        this._notifyChange()
    }

    /**
     * Log a message (internal use)
     * @private
     */
    _log(type, msg) {
        this.outputFn(type, msg)
    }

    /**
     * Show an error message
     * @private
     */
    _err(msg) {
        showMsg(msg)
        return false
    }

    /**
     * Notify UI of state change
     * @private
     */
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

// ─── Spell Context ────────────────────────────────────────────────────────────
// Injects spell-casting builtins into the Arcane interpreter.
// The engine enforces all rules — scripts can only express intent.

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

// Keys that belong to the spell context (filtered from user vars panel)
const SPELL_CONTEXT_KEYS = new Set([
    'pool', 'env',
    'gather', 'shape', 'attribute', 'speed', 'follow', 'reserve', 'explode', 'cast',
    'on_hit', 'on_deplete', 'on_check', 'on_low_mana',
    'mana_pool', 'self_mana', 'self_reserved', 'enemy_nearby', 'resize',
    'log', 'print',
    'rand', 'floor', 'ceil', 'round', 'abs', 'min', 'max', 'str', 'num',
])

// ═══════════════════════════════════════════════════════
//  GAME — built on the Arcane language + spell engine
// ═══════════════════════════════════════════════════════

const canvas = document.getElementById('c')
const ctx2d = canvas.getContext('2d')

function resize() {
    const margin = 80, maxW = Math.min(window.innerWidth - 32, 700), maxH = Math.min(window.innerHeight - margin, 520)
    canvas.width = canvas.height = Math.min(maxW, maxH)
}
resize(); window.addEventListener('resize', resize)
const W = () => canvas.width, H = () => canvas.height
const WALL = 24

// ── Player & pool ─────────────────────────────────────

class Pool {
    constructor(mana = 500, maxMana = 500, regenRate = 20, costMult = 1, manaOnKill = 0) {
        this.mana = mana
        this.maxMana = maxMana
        this.regenRate = regenRate
        this.costMult = costMult
        this.manaOnKill = manaOnKill
    }
}

class Player {
    constructor(x = 0, y = 0, r = 10, spd = 140, hp = 100, maxHp = 100, invincible = 0) {
        this.x = x
        this.y = y
        this.r = r
        this.spd = spd
        this.hp = hp
        this.maxHp = maxHp
        this.invincible = invincible
    }
}

class Projectile {
    constructor(caster, vx, vy, engine, snap, novaRadius = 0, novaMax = 130) {
        this.x = caster.x
        this.y = caster.y
        this.vx = vx
        this.vy = vy
        this.engine = engine
        this.snap = snap
        this.isNova = snap.shape === 'nova'
        const isBeam = snap.shape === 'beam'
        this.r = this.isNova ? snap.size * 20 : isBeam ? 4 : 6 + snap.size * 3
        this.novaRadius = novaRadius
        this.novaMax = novaMax
        this.alive = true
        this.color = ATTR_COLOR[engine.attributes[0]]
    }
}

class Enemy {
    constructor({ x, y, r, hp, maxHp, spd, phase, type }) {
        this.x = x
        this.y = y
        this.r = r
        this.hp = hp
        this.maxHp = maxHp
        this.spd = spd
        this.phase = phase
        this.type = type
    }
    update(dt) {
        this.phase += dt
        const dx = player.x - this.x, dy = player.y - this.y, d = Math.sqrt(dx * dx + dy * dy) || 1
        const px = -dy / d, py = dx / d, wb = Math.sin(this.phase * 2) * 0.3
        this.x += (dx / d + px * wb) * this.spd * dt
        this.y += (dy / d + py * wb) * this.spd * dt
        this.x = Math.max(WALL + this.r, Math.min(W() - WALL - this.r, this.x))
        this.y = Math.max(WALL + this.r, Math.min(H() - WALL - this.r, this.y))
        if (player.invincible <= 0 && d < player.r + this.r) {
            player.hp -= 10; player.invincible = 0.8
            spawnParticles(player.x, player.y, '#ff5f7e', 8, 120, 0.4)
            if (player.hp <= 0) { gameState = 'dead'; return }
        }
    }
    draw() {
        const a = this.hp / this.maxHp
        ctx2d.beginPath(); ctx2d.arc(this.x, this.y, this.r, 0, Math.PI * 2); ctx2d.fillStyle = 'rgba(180,50,80,0.85)'; ctx2d.fill()
        ctx2d.strokeStyle = '#ff5f7e'; ctx2d.lineWidth = 1.5; ctx2d.stroke()
        ctx2d.fillStyle = '#300'; ctx2d.fillRect(this.x - this.r, this.y - this.r - 6, this.r * 2, 3)
        ctx2d.fillStyle = '#ff5f7e'; ctx2d.fillRect(this.x - this.r, this.y - this.r - 6, this.r * 2 * a, 3)

    }
}

const pool = new Pool()
const player = new Player()

// ── Default scroll sources ────────────────────────────
const DEFAULT_SRC = [
    `gather(pool, 25)
shape("ball")
attribute("fire")
speed(6)
reserve(2)
on hit
  explode()
end
on deplete
  explode()
end`,
`gather(env, 1000)

on _enemy_nearby
  cast('fireball')
end

on_check({every: 0.2}, fn()
  if enemy_nearby()
    fire("_enemy_nearby")
  end
end)`,

    /* `gather(pool, 150)
shape("beam")
attribute("ice")
speed(10)
on_deplete(fn()
end)`, */

    `gather(env, 200)
shape("nova")
attribute("shadow")
reserve(150)
on_deplete(fn()
  explode()
end)`,

    null  // 4th slot locked
]

const ATTR_COLOR = {
    fire: '#ff6b35',
    light: '#bdbd17',
    ice: '#80deea',
    shadow: '#59375f',
    arcane: '#b39ddb',
    void: '#210021',
}

const SCROLL_META = [
    { name: 'Fireball', color: '#ff6b35' },
    { name: 'Ice Beam', color: '#80deea' },
    { name: 'Shadow Nova', color: '#ce93d8' },
    { name: 'Scroll 4', color: '#b39ddb' },
]

// live scroll sources — null = locked
let scrollSrc = DEFAULT_SRC.map(s => s)
let scrollAST = scrollSrc.map((s, i) => {
    let ast = null
    if (s) {
        const tokens = lex(s)
        ast = new Parser(tokens).parse()
    }
    return scrollSrc[i] === null ? null : ast
})
let scrollErrors = [null, null, null, null]
let selectedScroll = 0

// ── Wave ──────────────────────────────────────────────
let waveNum = 0
let waveEnemiesLeft = 0
let batchTimer = 0
let batchQueue = []

// ── World ─────────────────────────────────────────────
let enemies = [], projectiles = [], particles = [], spells = []
let mouse = { x: 0, y: 0 }, keys = {}
let score = 0, lastTime = 0
let gameState = 'menu'   // play | crafting | dead | menu | lab | paused

// ── High Score & Saved Spells ─────────────────────────
let highScore = parseInt(localStorage.getItem('arcane_highscore') || '0')
let savedSpells = JSON.parse(localStorage.getItem('arcane_saved_spells') || '[]')
if (!Array.isArray(savedSpells)) savedSpells = []

// ── Spell Lab ──────────────────────────────────────────
let labSpellName = 'New Spell'
let labSpellShape = null
let labSpellAttribute = null
let labSpellSpeed = 5
let labSpellSize = 1
let labSpellFollow = false
let labError = null
let labDummy = null
let labProjectile = null
let labEngine = null

// ─────────────────────────────────────────────────────
//  UPGRADES
// ─────────────────────────────────────────────────────
const ALL_UPGRADES = [
    { id: 'mana', title: '+100 Max Mana', desc: 'Permanently expand your mana pool.', apply: () => { pool.maxMana += 100; pool.mana = Math.min(pool.mana + 100, pool.maxMana) } },
    { id: 'regen', title: '+25% Mana Regen', desc: 'Your mana recovers faster between casts.', apply: () => { pool.regenRate *= 1.25 } },
    { id: 'slot', title: '4th Scroll Slot', desc: 'Unlock a fourth spell slot to write freely.', apply: () => { if (scrollSrc[3] === null) scrollSrc[3] = 'gather(pool, 80)\nshape("ball")\nattribute("arcane")\nspeed(5)' }, once: true },
    { id: 'cost', title: '-10% Spell Costs', desc: 'All gather amounts cost 10% less mana.', apply: () => { pool.costMult = Math.max(0.3, pool.costMult - 0.10) } },
    { id: 'hp', title: 'Restore + Max HP', desc: 'Heal to full and gain +20 max HP.', apply: () => { player.maxHp += 20; player.hp = player.maxHp } },
    { id: 'kill', title: 'Mana on Kill', desc: 'Each enemy death restores mana.', apply: () => { pool.manaOnKill += 8 } },
]
let chosenUpgradeIds = []

function pickUpgrades() {
    const avail = ALL_UPGRADES.filter(u => !(u.once && chosenUpgradeIds.includes(u.id)))
    return [...avail].sort(() => Math.random() - 0.5).slice(0, 3)
}

// ─────────────────────────────────────────────────────
//  SPELL RUNNING
// ─────────────────────────────────────────────────────
function tryCompile(src) {
    try { const t = lex(src); new Parser(t).parse(); return null }
    catch (e) { return e.message + (e.line ? ` (line ${e.line})` : '') }
}

function runScroll(ast, engine) {
    try {
        const ctx = makeSpellContext(engine)
        const interp = new Interpreter(ctx, engine.outputFn)
        // when the editor is closed, compile and create the spell, then,
        // when the player cast the spell, summon the spell object, instead of running it all over again
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

// ─────────────────────────────────────────────────────
//  WAVE SYSTEM
// ─────────────────────────────────────────────────────
function startWave(n) {
    waveNum = n
    const total = 10 + (n - 1) * 3
    waveEnemiesLeft = total
    batchQueue = []
    let rem = total
    while (rem > 0) {
        const sz = Math.min(rem, 3 + Math.floor(Math.random() * 3))
        batchQueue.push(sz); rem -= sz
    }
    batchTimer = 0
    spawnBatch()
}

function spawnBatch() {
    if (!batchQueue.length) return
    const count = batchQueue.shift()
    for (let i = 0; i < count; i++) spawnEnemy()
}

const ENEMY_TYPES = {
    basic: { hp: 25, spd: 36, r: 12, color: '#b43250' },
    tank: { hp: 60, spd: 18, r: 18, color: '#8b2252' },
    swift: { hp: 15, spd: 72, r: 8, color: '#ff6b9d' },
    caster: { hp: 20, spd: 28, r: 14, color: '#9b59b6' }
};

function spawnEnemy() {
    const side = Math.floor(Math.random() * 4), pad = WALL + 20
    let x, y
    if (side === 0) { x = pad + Math.random() * (W() - pad * 2); y = pad }
    else if (side === 1) { x = W() - pad; y = pad + Math.random() * (H() - pad * 2) }
    else if (side === 2) { x = pad + Math.random() * (W() - pad * 2); y = H() - pad }
    else { x = pad; y = pad + Math.random() * (H() - pad * 2) }

    const type = Math.random() < 0.6 ? 'basic' :
        Math.random() < 0.5 ? 'tank' :
            Math.random() < 0.5 ? 'swift' : 'caster';
    const template = ENEMY_TYPES[type];
    enemies.push(new Enemy({
        ...template,
        type,
        x, y,
        maxHp: template.hp + waveNum * (type === 'tank' ? 12 : 6),
        hp: template.hp + waveNum * (type === 'tank' ? 12 : 6),
        phase: Math.random() * Math.PI * 2
    }))
}

function checkWaveComplete() {
    if (waveEnemiesLeft <= 0 && enemies.length === 0 && batchQueue.length === 0)
        openCraftScreen()
}

// ─────────────────────────────────────────────────────
//  CRAFTING SCREEN
// ─────────────────────────────────────────────────────
let craftActiveTab = 0, pendingSrcs = [], craftUpgrades = [], chosenUpgrade = null

function openCraftScreen() {
    gameState = 'crafting'
    pendingSrcs = scrollSrc.map(s => s || '')
    scrollErrors = [null, null, null, null]
    craftUpgrades = pickUpgrades()
    chosenUpgrade = null
    craftActiveTab = 0
    buildScrollTabs()
    loadTab(0)
    buildUpgradeCards()
    updateNextBtn()
    document.getElementById('craft-subtitle').textContent =
        `wave ${waveNum} complete \u00b7 edit your scrolls \u00b7 choose an upgrade`
    document.getElementById('craft-screen').classList.add('open')
}

function closeCraftScreen() {
    document.getElementById('craft-screen').classList.remove('open')
}

function buildScrollTabs() {
    const el = document.getElementById('scroll-tabs')
    el.innerHTML = ''
    scrollSrc.forEach((s, i) => {
        if (s === null) return
        const tab = document.createElement('div')
        tab.className = 'stab' + (i === craftActiveTab ? ' active' : '')
        tab.innerHTML = SCROLL_META[i].name + (scrollErrors[i] ? '<span class="terr">error</span>' : '')
        tab.addEventListener('click', () => { saveTab(); craftActiveTab = i; loadTab(i); buildScrollTabs() })
        el.appendChild(tab)
    })
}

function loadTab(i) {
    const ed = document.getElementById('craft-editor')
    ed.value = pendingSrcs[i] || ''
    updateLineNums(); validateTab()
}

function saveTab() {
    pendingSrcs[craftActiveTab] = document.getElementById('craft-editor').value
}

function validateTab() {
    const src = document.getElementById('craft-editor').value
    const err = tryCompile(src)
    scrollErrors[craftActiveTab] = err
    document.getElementById('craft-error').textContent = err || ''
    buildScrollTabs(); updateNextBtn()
}

function updateNextBtn() {
    const hasErr = scrollErrors.some((e, i) => e && scrollSrc[i] !== null)
    document.getElementById('btn-next-wave').disabled = hasErr || !chosenUpgrade
}

function buildUpgradeCards() {
    const el = document.getElementById('upgrade-cards')
    el.innerHTML = ''
    craftUpgrades.forEach(upg => {
        const card = document.createElement('div')
        card.className = 'upg-card'
        card.innerHTML = `<div class="utitle">${upg.title}</div><div class="udesc">${upg.desc}</div>`
        card.addEventListener('click', () => {
            if (chosenUpgrade) return
            chosenUpgrade = upg; card.classList.add('chosen'); updateNextBtn()
        })
        el.appendChild(card)
    })
}

function updateLineNums() {
    const ed = document.getElementById('craft-editor')
    const nums = document.getElementById('craft-line-nums')
    const count = ed.value.split('\n').length
    nums.innerHTML = Array.from({ length: count }, (_, i) => `<div>${i + 1}</div>`).join('')
}

document.getElementById('craft-editor').addEventListener('input', () => { updateLineNums(); validateTab(); saveTab() })
document.getElementById('craft-editor').addEventListener('keydown', e => {
    if (e.key === 'Tab') {
        e.preventDefault()
        const s = e.target.selectionStart, end = e.target.selectionEnd
        e.target.value = e.target.value.substring(0, s) + '  ' + e.target.value.substring(end)
        e.target.selectionStart = e.target.selectionEnd = s + 2
        updateLineNums()
    }
})
document.getElementById('craft-editor').addEventListener('scroll', e => {
    document.getElementById('craft-line-nums').scrollTop = e.target.scrollTop
})
document.getElementById('btn-reset-scroll').addEventListener('click', () => {
    const def = DEFAULT_SRC[craftActiveTab]
    if (!def) return
    pendingSrcs[craftActiveTab] = def
    document.getElementById('craft-editor').value = def
    updateLineNums(); validateTab()
})
document.getElementById('btn-next-wave').addEventListener('click', () => {
    saveTab() // save the current spell being edited
    scrollSrc = pendingSrcs.map((s, i) => scrollSrc[i] === null ? null : s)//Update the Src of the saved spells
    scrollAST = scrollSrc.map((s, i) => {
        let ast = ''
        if (s) {
            const tokens = lex(s)
            ast = new Parser(tokens).parse()
        }
        return scrollSrc[i] === null ? null : ast
    })
    if (chosenUpgrade) { chosenUpgrade.apply(); chosenUpgradeIds.push(chosenUpgrade.id) }//Apply the chosen upgrade
    closeCraftScreen()
    projectiles = []; particles = []//reset the projectiles and particles
    player.hp = Math.min(player.maxHp, player.hp + 20)//Heal the player
    pool.mana = pool.maxMana // Set the mana to its maximum
    buildScrollBar()
    gameState = 'play'
    startWave(waveNum + 1)
})

// ─────────────────────────────────────────────────────
//  CASTING
// ─────────────────────────────────────────────────────
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

function castSpell(tx, ty) {

    //get spell
    //check for casting avaliability
    //cast spellname

    const ast = scrollAST[selectedScroll] // GET SELECTED SPELL

    if (!ast) { showMsg('Slot locked'); return } // CHECKS IF THE SELECTED SPELL SLOT IS UNLOCKED

    if (scrollErrors[selectedScroll]) { showMsg('Scroll has errors — open Grimoire to fix'); return }

    const engine = new SpellEngine({//Create Engine that Runs the spell
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

// ─────────────────────────────────────────────────────

//  PARTICLES
// ─────────────────────────────────────────────────────
function spawnParticles(x, y, color, count, spd, life) {
    for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2, s = spd * (0.4 + Math.random() * 0.6)
        particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, color, life, maxLife: life, r: 2 + Math.random() * 3 })
    }
}
function spawnExplosion(x, y, color, radius) {
    spawnParticles(x, y, color, 18, 200, 0.5)
    particles.push({ type: 'ring', x, y, r: 0, maxR: radius, color, life: 0.4, maxLife: 0.4 })
}

// ─────────────────────────────────────────────────────
//  SPELL LAB FUNCTIONS
// ─────────────────────────────────────────────────────
function initLab() {
    labDummy = { x: W() / 2 + 100, y: H() / 2, r: 25, hp: 500, maxHp: 500 }
    labProjectile = null
    labEngine = null
    labError = null
    labSpellName = 'New Spell'
    labSpellShape = null
    labSpellAttribute = null
    labSpellSpeed = 5
    labSpellSize = 1
    labSpellFollow = false
}

function updateLab(dt) {
    // Update dummy (stationary)
    if (labDummy && labDummy.hp <= 0) {
        // Respawn dummy
        labDummy.hp = labDummy.maxHp
    }
    
    // Update projectile
    if (labProjectile && labEngine) {
        labEngine.tick(dt)
        
        if (labEngine.phase === 'active' && labProjectile.alive) {
            const p = labProjectile
            p.x += p.vx * dt
            p.y += p.vy * dt
            
            // Check collision with dummy
            const dx = p.x - labDummy.x
            const dy = p.y - labDummy.y
            const dist = Math.sqrt(dx * dx + dy * dy)
            
            if (dist < p.r + labDummy.r) {
                // Hit!
                const dmg = Math.floor(5 * Math.sqrt(labEngine.reserved) || 10)
                labDummy.hp = Math.max(0, labDummy.hp - dmg)
                
                // Spawn particles
                spawnParticles(p.x, p.y, ATTR_COLOR[labEngine.attributes[0]] || '#a87fd4', 12, 150, 0.3)
                
                // Deactivate projectile
                p.alive = false
                labEngine.phase = 'dead'
            }
            
            // Remove if out of bounds
            if (p.x < 0 || p.x > W() || p.y < 0 || p.y > H()) {
                p.alive = false
                labEngine.phase = 'dead'
            }
        }
        
        if (labEngine.phase === 'dead') {
            labProjectile = null
            labEngine = null
        }
    }
}

function castLabSpell(tx, ty) {
    // Clear previous spell
    if (labProjectile) {
        labProjectile.alive = false
        labProjectile = null
        labEngine = null
    }
    
    // Build spell script from lab settings
    let script = `gather(pool, 50)\n`
    if (labSpellShape) {
        script += `shape("${labSpellShape}"${labSpellSize > 1 ? `, ${labSpellSize}` : ''})\n`
    }
    if (labSpellAttribute) {
        script += `attribute("${labSpellAttribute}")\n`
    }
    script += `speed(${labSpellSpeed})`
    if (labSpellFollow) {
        script += `\nfollow("target")`
    }
    
    // Parse the spell script
    try {
        const tokens = lex(script)
        const ast = new Parser(tokens).parse()
        
        if (!ast) {
            labError = 'Failed to parse spell'
            return
        }
        
        labError = null
        
        // Create engine with infinite mana
        const engine = new SpellEngine({
            outputFn: (type, msg) => {},
            poolMana: Infinity,
            envMana: Infinity
        })
        
        if (!runScroll(ast, engine)) {
            labError = 'Failed to run spell'
            return
        }
        
        if (engine.phase === 'idle' || engine.phase === 'dead') {
            labError = 'Spell did not activate'
            return
        }
        
        labEngine = engine
        
        // Spawn projectile
        const proj = SpawnProj({ x: W() / 2 - 150, y: H() / 2, vx: 0, vy: 0 }, { x: tx, y: ty }, engine)
        
        const snap = engine.snapshot()
        const dx = tx - proj.x, dy = ty - proj.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const speed = engine.spellSpeed * 100
        
        proj.vx = (dx / dist) * speed
        proj.vy = (dy / dist) * speed
        
        const isNova = snap.shape === 'nova'
        if (isNova) {
            proj.vx = 0
            proj.vy = 0
        }
        
        labProjectile = proj
        
    } catch (e) {
        labError = e.message || 'Unknown error'
    }
}

// ─────────────────────────────────────────────────────
//  UPDATE
// ─────────────────────────────────────────────────────
function update(ts) {
    
    const dt = Math.min((ts - lastTime) / 1000, 0.05)
    lastTime = ts

    if (gameState === 'dead') { drawDead(); requestAnimationFrame(update); return }
    if (gameState === 'crafting') { requestAnimationFrame(update); return }
    if (gameState === 'menu') { drawMenu(); requestAnimationFrame(update); return }
    if (gameState === 'paused') { drawPaused(); requestAnimationFrame(update); return }
    if (gameState === 'lab') { updateLab(dt); drawLab(); requestAnimationFrame(update); return }

    pool.mana = Math.min(pool.maxMana, pool.mana + pool.regenRate * dt)

    let mx = 0, my = 0
    if (keys['w'] || keys['arrowup']) my = -1
    if (keys['s'] || keys['arrowdown']) my = 1
    if (keys['a'] || keys['arrowleft']) mx = -1
    if (keys['d'] || keys['arrowright']) mx = 1
    if (mx && my) { mx *= 0.707; my *= 0.707 }
    player.x = Math.max(WALL + player.r, Math.min(W() - WALL - player.r, player.x + mx * player.spd * dt))
    player.y = Math.max(WALL + player.r, Math.min(H() - WALL - player.r, player.y + my * player.spd * dt))
    if (player.invincible > 0) player.invincible -= dt

    if (batchQueue.length > 0) {
        batchTimer -= dt
        if (batchTimer <= 0) { batchTimer = 3 + Math.random() * 2; spawnBatch() }
    }

    for (const e of enemies) {
        e.update(dt)
    }

    for (const p of projectiles) {
        if (!p.alive) continue
        p.engine.tick(dt)
        if (p.engine.phase !== 'active') continue
        if (p.isNova) {
            p.novaRadius += 300 * dt
            if (p.novaRadius >= p.novaMax || p.engine.phase === 'dead') {
                const dmg = Math.floor(5 * Math.sqrt(p.engine.reserved) || 0)
                for (const e of enemies) {
                    const dx = e.x - p.x, dy = e.y - p.y
                    if (Math.sqrt(dx * dx + dy * dy) < p.novaRadius) { e.hp -= dmg; spawnParticles(e.x, e.y, p.color, 6, 100, 0.3) }
                }
                spawnExplosion(p.x, p.y, p.color, p.novaMax); p.alive = false; continue
            }
        } else {
            p.x += p.vx * dt; p.y += p.vy * dt
            if (Math.random() < 0.6) spawnParticles(p.x, p.y, p.color, 1, 20, 0.2)
            if (p.x < WALL || p.x > W() - WALL || p.y < WALL || p.y > H() - WALL) {
                spawnExplosion(p.x, p.y, p.color, 30); p.engine.triggerHit(); p.alive = false; continue
            }
            let hit = false
            for (const e of enemies) {
                const dx = e.x - p.x, dy = e.y - p.y
                if (Math.sqrt(dx * dx + dy * dy) < e.r + p.r) {
                    e.hp -= 15 + (p.engine.reserved || 0) * 0.8
                    spawnExplosion(p.x, p.y, p.color, 40); p.engine.triggerHit()
                    spawnParticles(e.x, e.y, p.color, 8, 100, 0.35); p.alive = false; hit = true; break
                }
            }
            if (hit) continue
        }
        if (p.engine.phase === 'dead' && p.alive) { spawnExplosion(p.x, p.y, p.color, 35); p.alive = false }
    }
    projectiles = projectiles.filter(p => p.alive)

    enemies = enemies.filter(e => {
        if (e.hp <= 0) {
            spawnParticles(e.x, e.y, '#ff5f7e', 12, 150, 0.5)
            score++; waveEnemiesLeft--
            if (pool.manaOnKill > 0) pool.mana = Math.min(pool.maxMana, pool.mana + pool.manaOnKill)
            return false
        }
        return true
    })

    for (const p of particles) {
        p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; p.life -= dt
        if (p.type === 'ring') p.r = (1 - p.life / p.maxLife) * p.maxR
    }
    particles = particles.filter(p => p.life > 0)

    checkWaveComplete()
    draw()
    requestAnimationFrame(update)
}

// ─────────────────────────────────────────────────────
//  DRAW
// ─────────────────────────────────────────────────────
function draw() {
    const W_ = W(), H_ = H()
    ctx2d.clearRect(0, 0, W_, H_)
    ctx2d.fillStyle = '#0c0c14'; ctx2d.fillRect(0, 0, W_, H_)

    ctx2d.strokeStyle = '#1a1a2e'; ctx2d.lineWidth = 1
    for (let x = WALL; x < W_ - WALL; x += 40) { ctx2d.beginPath(); ctx2d.moveTo(x, WALL); ctx2d.lineTo(x, H_ - WALL); ctx2d.stroke() }
    for (let y = WALL; y < H_ - WALL; y += 40) { ctx2d.beginPath(); ctx2d.moveTo(WALL, y); ctx2d.lineTo(W_ - WALL, y); ctx2d.stroke() }

    ctx2d.fillStyle = '#0f0f1e'
    ctx2d.fillRect(0, 0, W_, WALL); ctx2d.fillRect(0, H_ - WALL, W_, WALL)
    ctx2d.fillRect(0, 0, WALL, H_); ctx2d.fillRect(W_ - WALL, 0, WALL, H_)
    ctx2d.strokeStyle = '#2a2a4a'; ctx2d.lineWidth = 2
    ctx2d.strokeRect(WALL, WALL, W_ - WALL * 2, H_ - WALL * 2)

    for (const p of particles) {
        const a = p.life / p.maxLife
        if (p.type === 'ring') { ctx2d.beginPath(); ctx2d.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx2d.strokeStyle = p.color + Math.floor(a * 255).toString(16).padStart(2, '0'); ctx2d.lineWidth = 2; ctx2d.stroke() }
        else { ctx2d.beginPath(); ctx2d.arc(p.x, p.y, p.r * a, 0, Math.PI * 2); ctx2d.fillStyle = p.color + Math.floor(a * 200).toString(16).padStart(2, '0'); ctx2d.fill() }
    }

    for (const e of enemies) {
        e.draw()
    }

    for (const p of projectiles) {
        if (p.engine.phase === 'gathering') drawGatheringIndicator(player, p.engine.progress)
        if (p.engine.phase !== 'active') continue
        if (!p.alive) continue
        if (p.isNova) {
            const a = 1 - p.novaRadius / p.novaMax
            ctx2d.beginPath(); ctx2d.arc(p.x, p.y, p.novaRadius, 0, Math.PI * 2)
            ctx2d.strokeStyle = p.color + Math.floor(a * 255).toString(16).padStart(2, '0'); ctx2d.lineWidth = 4; ctx2d.stroke()
            ctx2d.fillStyle = p.color + Math.floor(a * 40).toString(16).padStart(2, '0'); ctx2d.fill()
        } else {
            if (p.color == undefined) p.color = ATTR_COLOR['arcane']
            const grd = ctx2d.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 2.5)
            grd.addColorStop(0, p.color + 'cc'); grd.addColorStop(1, p.color + '00')
            ctx2d.beginPath(); ctx2d.arc(p.x, p.y, p.r * 2.5, 0, Math.PI * 2); ctx2d.fillStyle = grd; ctx2d.fill()
            ctx2d.beginPath(); ctx2d.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx2d.fillStyle = p.color; ctx2d.fill()
        }
    }

    const flash = player.invincible > 0 && Math.floor(player.invincible * 10) % 2 === 0
    if (!flash) {
        const grd = ctx2d.createRadialGradient(player.x, player.y, 0, player.x, player.y, player.r * 3)
        grd.addColorStop(0, 'rgba(168,127,212,0.3)'); grd.addColorStop(1, 'rgba(168,127,212,0)')
        ctx2d.beginPath(); ctx2d.arc(player.x, player.y, player.r * 3, 0, Math.PI * 2); ctx2d.fillStyle = grd; ctx2d.fill()
        ctx2d.beginPath(); ctx2d.arc(player.x, player.y, player.r, 0, Math.PI * 2); ctx2d.fillStyle = '#e8e0f8'; ctx2d.fill()
        ctx2d.strokeStyle = '#a87fd4'; ctx2d.lineWidth = 2; ctx2d.stroke()
        const dx = mouse.x - player.x, dy = mouse.y - player.y, d = Math.sqrt(dx * dx + dy * dy) || 1
        ctx2d.beginPath(); ctx2d.moveTo(player.x, player.y); ctx2d.lineTo(player.x + dx / d * 20, player.y + dy / d * 20)
        ctx2d.strokeStyle = '#a87fd488'; ctx2d.lineWidth = 1.5; ctx2d.stroke()
    }

    const hpPct = player.hp / player.maxHp
    ctx2d.fillStyle = '#1a1a2e'; ctx2d.fillRect(WALL, 6, 120, 8)
    ctx2d.fillStyle = hpPct > 0.5 ? '#66d9a0' : hpPct > 0.25 ? '#ffb347' : '#ff5f7e'
    ctx2d.fillRect(WALL, 6, 120 * hpPct, 8)
    ctx2d.font = '9px monospace'; ctx2d.fillStyle = '#c8c0e0'; ctx2d.fillText('HP', WALL + 124, 14)

    const rem = enemies.length + batchQueue.reduce((a, b) => a + b, 0)
    ctx2d.textAlign = 'right'; ctx2d.font = '10px monospace'; ctx2d.fillStyle = '#5a5475'
    ctx2d.fillText('wave ' + waveNum + '  score ' + score, W_ - WALL - 4, 16)
    ctx2d.fillText('enemies ' + rem, W_ - WALL - 4, 30)
    ctx2d.textAlign = 'left'

    const pct = pool.mana / pool.maxMana
    document.getElementById('mana-fill').style.width = (pct * 100) + '%'
    document.getElementById('mana-val').textContent = Math.floor(pool.mana) + ' / ' + pool.maxMana
}

// Add a casting indicator when spells are gathering from environment
function drawGatheringIndicator(player, progress) {
    progress /= 100
    ctx2d.beginPath();
    ctx2d.arc(player.x, player.y, 30, 0, Math.PI * 2 * progress);
    ctx2d.strokeStyle = '#a87fd4';
    ctx2d.lineWidth = 3;
    ctx2d.stroke();
    ctx2d.fillStyle = `rgba(168, 127, 212, ${0.1 + progress * 0.2})`;
    ctx2d.fill();
}

function drawDead() {
    const W_ = W(), H_ = H()
    
    // Background overlay
    ctx2d.fillStyle = 'rgba(10,10,15,0.92)'
    ctx2d.fillRect(0, 0, W_, H_)
    
    // Title
    ctx2d.textAlign = 'center'
    ctx2d.font = 'bold 48px monospace'
    ctx2d.fillStyle = '#ff5f7e'
    ctx2d.fillText('YOU LOST', W_ / 2, H_ / 2 - 60)
    
    // Stats
    ctx2d.font = '16px monospace'
    ctx2d.fillStyle = '#c8c0e0'
    ctx2d.fillText('Wave Reached: ' + waveNum, W_ / 2, H_ / 2 - 10)
    ctx2d.fillText('Final Score: ' + score, W_ / 2, H_ / 2 + 15)
    
    // High score check
    if (score > highScore) {
        highScore = score
        localStorage.setItem('arcane_highscore', highScore.toString())
        ctx2d.font = 'bold 14px monospace'
        ctx2d.fillStyle = '#ffd93d'
        ctx2d.fillText('NEW HIGH SCORE!', W_ / 2, H_ / 2 + 40)
    }
    
    // Click prompt
    ctx2d.font = 'bold 18px monospace'
    ctx2d.fillStyle = '#9b7aff'
    ctx2d.fillText('CLICK TO RETURN TO MENU', W_ / 2, H_ / 2 + 75)
    
    ctx2d.textAlign = 'left'
}

// ─────────────────────────────────────────────────────
//  PAUSE SCREEN
// ─────────────────────────────────────────────────────
function drawPaused() {
    const W_ = W(), H_ = H()
    
    // Semi-transparent overlay
    ctx2d.fillStyle = 'rgba(10,10,15,0.85)'
    ctx2d.fillRect(0, 0, W_, H_)
    
    // Title
    ctx2d.textAlign = 'center'
    ctx2d.font = 'bold 48px monospace'
    ctx2d.fillStyle = '#9b7aff'
    ctx2d.fillText('PAUSED', W_ / 2, H_ / 2 - 80)
    
    // Buttons
    ctx2d.font = 'bold 20px monospace'
    
    // Resume button
    ctx2d.fillStyle = '#2a2a4a'
    ctx2d.fillRect(W_ / 2 - 80, H_ / 2 - 20, 160, 40)
    ctx2d.strokeStyle = '#9b7aff'
    ctx2d.lineWidth = 2
    ctx2d.strokeRect(W_ / 2 - 80, H_ / 2 - 20, 160, 40)
    ctx2d.fillStyle = '#c8c0e0'
    ctx2d.fillText('RESUME', W_ / 2, H_ / 2 + 8)
    
    // Quit to menu button
    ctx2d.fillStyle = '#2a2a4a'
    ctx2d.fillRect(W_ / 2 - 80, H_ / 2 + 30, 160, 40)
    ctx2d.strokeStyle = '#ff5f7e'
    ctx2d.strokeRect(W_ / 2 - 80, H_ / 2 + 30, 160, 40)
    ctx2d.fillStyle = '#ff5f7e'
    ctx2d.fillText('QUIT TO MENU', W_ / 2, H_ / 2 + 58)
    
    // Hint
    ctx2d.font = '12px monospace'
    ctx2d.fillStyle = '#6a6a8a'
    ctx2d.fillText('Press ESC or P to resume', W_ / 2, H_ / 2 + 100)
    
    ctx2d.textAlign = 'left'
}

// ─────────────────────────────────────────────────────
//  MENU SCREEN
// ─────────────────────────────────────────────────────
function drawMenu() {
    const W_ = W(), H_ = H()
    
    // Background gradient
    const grad = ctx2d.createLinearGradient(0, 0, 0, H_)
    grad.addColorStop(0, '#0a0a12')
    grad.addColorStop(1, '#1a1a2e')
    ctx2d.fillStyle = grad
    ctx2d.fillRect(0, 0, W_, H_)
    
    // Title
    ctx2d.textAlign = 'center'
    ctx2d.font = 'bold 48px monospace'
    ctx2d.fillStyle = '#9b7aff'
    ctx2d.fillText('ARCANE SPELLFORGE', W_ / 2, H_ / 2 - 100)
    
    // Subtitle
    ctx2d.font = '16px monospace'
    ctx2d.fillStyle = '#6a5a8a'
    ctx2d.fillText('Craft spells • Survive waves • Master mana', W_ / 2, H_ / 2 - 70)
    
    // Menu options
    ctx2d.font = 'bold 20px monospace'
    ctx2d.fillStyle = '#c8c0e0'
    ctx2d.fillText('CLICK or PRESS ENTER TO START', W_ / 2, H_ / 2 - 20)
    ctx2d.fillStyle = '#9b7aff'
    ctx2d.fillText('PRESS "L" FOR SPELL LAB', W_ / 2, H_ / 2 + 15)
    
    // Controls hint
    ctx2d.font = '12px monospace'
    ctx2d.fillStyle = '#4a4465'
    ctx2d.fillText('WASD/Arrows to move • Edit scrolls between waves', W_ / 2, H_ / 2 + 55)
    
    ctx2d.textAlign = 'left'
}

// ─────────────────────────────────────────────────────
//  SPELL LAB SCREEN
// ─────────────────────────────────────────────────────
function drawLab() {
    const W_ = W(), H_ = H()
    
    // Background
    ctx2d.fillStyle = '#0d0d1a'
    ctx2d.fillRect(0, 0, W_, H_)
    
    // Grid
    ctx2d.strokeStyle = '#1a1a2e'
    ctx2d.lineWidth = 1
    for (let x = 0; x < W_; x += 40) { ctx2d.beginPath(); ctx2d.moveTo(x, 0); ctx2d.lineTo(x, H_); ctx2d.stroke() }
    for (let y = 0; y < H_; y += 40) { ctx2d.beginPath(); ctx2d.moveTo(0, y); ctx2d.lineTo(W_, y); ctx2d.stroke() }
    
    // Draw dummy
    if (labDummy) {
        ctx2d.beginPath()
        ctx2d.arc(labDummy.x, labDummy.y, labDummy.r, 0, Math.PI * 2)
        ctx2d.fillStyle = '#3a3a5a'
        ctx2d.fill()
        ctx2d.strokeStyle = '#6a6a9a'
        ctx2d.lineWidth = 2
        ctx2d.stroke()
        
        // HP bar
        const hpPct = labDummy.hp / labDummy.maxHp
        ctx2d.fillStyle = '#1a1a2e'
        ctx2d.fillRect(labDummy.x - 20, labDummy.y - labDummy.r - 12, 40, 6)
        ctx2d.fillStyle = hpPct > 0.5 ? '#66d9a0' : hpPct > 0.25 ? '#ffb347' : '#ff5f7e'
        ctx2d.fillRect(labDummy.x - 20, labDummy.y - labDummy.r - 12, 40 * hpPct, 6)
        
        // HP text
        ctx2d.font = '8px monospace'
        ctx2d.fillStyle = '#aaaacc'
        ctx2d.textAlign = 'center'
        ctx2d.fillText(Math.floor(labDummy.hp) + '/' + labDummy.maxHp, labDummy.x, labDummy.y - labDummy.r - 15)
        ctx2d.textAlign = 'left'
    }
    
    // Draw projectile
    if (labProjectile && labEngine && labEngine.phase === 'active') {
        const p = labProjectile
        const color = ATTR_COLOR[p.engine.attributes[0]] || '#a87fd4'
        const grd = ctx2d.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 2.5)
        grd.addColorStop(0, color + 'cc')
        grd.addColorStop(1, color + '00')
        ctx2d.beginPath()
        ctx2d.arc(p.x, p.y, p.r * 2.5, 0, Math.PI * 2)
        ctx2d.fillStyle = grd
        ctx2d.fill()
        ctx2d.beginPath()
        ctx2d.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx2d.fillStyle = color
        ctx2d.fill()
    }
    
    // Editor panel
    ctx2d.fillStyle = 'rgba(15, 15, 30, 0.95)'
    ctx2d.fillRect(10, 10, 320, H_ - 20)
    ctx2d.strokeStyle = '#3a3a5a'
    ctx2d.lineWidth = 1
    ctx2d.strokeRect(10, 10, 320, H_ - 20)
    
    // Title
    ctx2d.font = 'bold 16px monospace'
    ctx2d.fillStyle = '#9b7aff'
    ctx2d.fillText('SPELL LAB', 25, 35)
    
    ctx2d.font = '11px monospace'
    ctx2d.fillStyle = '#8a8aac'
    ctx2d.fillText('Configure spell • Click canvas to cast', 25, 52)
    
    // Spell name input label
    ctx2d.font = 'bold 12px monospace'
    ctx2d.fillStyle = '#c8c0e0'
    ctx2d.fillText('Spell Name:', 25, 80)
    ctx2d.font = '11px monospace'
    ctx2d.fillStyle = '#9b7aff'
    ctx2d.fillText(labSpellName, 120, 80)
    
    // Status display
    ctx2d.font = '10px monospace'
    ctx2d.fillStyle = '#6a6a8a'
    ctx2d.fillText('━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 25, 100)
    
    // Shape buttons
    ctx2d.font = 'bold 11px monospace'
    ctx2d.fillStyle = '#c8c0e0'
    ctx2d.fillText('Shape:', 25, 120)
    const shapes = ['ball', 'cone', 'beam', 'nova', 'wall']
    let sx = 25
    for (const shape of shapes) {
        const isSelected = labSpellShape === shape
        const btnW = 50, btnH = 22
        ctx2d.fillStyle = isSelected ? '#9b7aff' : '#2a2a4a'
        ctx2d.fillRect(sx, 132, btnW, btnH)
        ctx2d.strokeStyle = isSelected ? '#c8c0e0' : '#4a4a6a'
        ctx2d.strokeRect(sx, 132, btnW, btnH)
        ctx2d.fillStyle = isSelected ? '#fff' : '#8a8aac'
        ctx2d.font = '10px monospace'
        ctx2d.textAlign = 'center'
        ctx2d.fillText(shape, sx + btnW/2, 147)
        sx += btnW + 5
    }
    ctx2d.textAlign = 'left'
    
    // Attribute buttons
    ctx2d.font = 'bold 11px monospace'
    ctx2d.fillStyle = '#c8c0e0'
    ctx2d.fillText('Attribute:', 25, 175)
    const attrs = ['fire', 'ice', 'light', 'shadow', 'arcane', 'void']
    const attrColors = { fire: '#ff6b6b', ice: '#6bb6ff', light: '#ffd93d', shadow: '#a855f7', arcane: '#c084fc', void: '#64748b' }
    let ax = 25
    for (const attr of attrs) {
        const isSelected = labSpellAttribute === attr
        const btnW = 48, btnH = 22
        ctx2d.fillStyle = isSelected ? attrColors[attr] : '#2a2a4a'
        ctx2d.fillRect(ax, 187, btnW, btnH)
        ctx2d.strokeStyle = isSelected ? '#fff' : '#4a4a6a'
        ctx2d.strokeRect(ax, 187, btnW, btnH)
        ctx2d.fillStyle = isSelected ? '#fff' : '#8a8aac'
        ctx2d.font = '9px monospace'
        ctx2d.textAlign = 'center'
        ctx2d.fillText(attr, ax + btnW/2, 202)
        ax += btnW + 4
    }
    ctx2d.textAlign = 'left'
    
    // Speed slider label
    ctx2d.font = 'bold 11px monospace'
    ctx2d.fillStyle = '#c8c0e0'
    ctx2d.fillText('Speed: ' + labSpellSpeed.toFixed(0), 25, 230)
    ctx2d.fillStyle = '#3a3a5a'
    ctx2d.fillRect(25, 240, 200, 12)
    ctx2d.fillStyle = '#9b7aff'
    ctx2d.fillRect(25, 240, (labSpellSpeed / 10) * 200, 12)
    ctx2d.strokeStyle = '#4a4a6a'
    ctx2d.strokeRect(25, 240, 200, 12)
    
    // Size control
    ctx2d.font = 'bold 11px monospace'
    ctx2d.fillStyle = '#c8c0e0'
    ctx2d.fillText('Size: ' + labSpellSize, 25, 270)
    ctx2d.fillStyle = '#3a3a5a'
    ctx2d.fillRect(25, 280, 100, 12)
    ctx2d.fillStyle = '#9b7aff'
    ctx2d.fillRect(25, 280, ((labSpellSize - 1) / 4) * 100, 12)
    ctx2d.strokeStyle = '#4a4a6a'
    ctx2d.strokeRect(25, 280, 100, 12)
    
    // Follow toggle
    ctx2d.font = 'bold 11px monospace'
    ctx2d.fillStyle = '#c8c0e0'
    ctx2d.fillText('Follow Target:', 25, 315)
    ctx2d.fillStyle = labSpellFollow ? '#66d9a0' : '#ff5f7e'
    ctx2d.fillRect(140, 308, 50, 20)
    ctx2d.fillStyle = '#fff'
    ctx2d.font = '10px monospace'
    ctx2d.textAlign = 'center'
    ctx2d.fillText(labSpellFollow ? 'ON' : 'OFF', 165, 322)
    ctx2d.textAlign = 'left'
    
    // Save/Load buttons area
    ctx2d.font = 'bold 11px monospace'
    ctx2d.fillStyle = '#c8c0e0'
    ctx2d.fillText('Saved Spells:', 25, 355)
    ctx2d.fillStyle = '#6a6a8a'
    ctx2d.font = '9px monospace'
    for (let i = 0; i < Math.min(3, savedSpells.length); i++) {
        ctx2d.fillText(savedSpells[i].name, 25, 370 + i * 15)
    }
    
    // Active spell status
    ctx2d.font = '10px monospace'
    ctx2d.fillStyle = '#6a6a8a'
    ctx2d.fillText('━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 25, 420)
    
    if (labEngine) {
        ctx2d.fillStyle = '#aaaacc'
        ctx2d.fillText('Shape: ' + (labEngine.spellShape || 'none'), 25, 438)
        ctx2d.fillText('Attr: ' + (labEngine.attributes.join(', ') || 'none'), 25, 452)
        ctx2d.fillText('Speed: ' + labEngine.spellSpeed.toFixed(1), 25, 466)
        ctx2d.fillText('Size: ' + labEngine.size, 25, 480)
        ctx2d.fillText('Drain: ' + labEngine.drainRate.toFixed(1) + '/s', 25, 494)
        ctx2d.fillText('Phase: ' + labEngine.phase, 25, 508)
        ctx2d.fillText('Mana: ' + Math.floor(labEngine.mana), 25, 522)
    } else {
        ctx2d.fillStyle = '#6a6a8a'
        ctx2d.fillText('No active spell', 25, 438)
    }
    
    ctx2d.fillStyle = '#6a6a8a'
    ctx2d.fillText('━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 25, 540)
    ctx2d.fillStyle = '#4a9a6a'
    ctx2d.fillText('INFINITE MANA', 25, 558)
    
    // Controls hint
    ctx2d.font = '9px monospace'
    ctx2d.fillStyle = '#4a4a6a'
    ctx2d.fillText('Click buttons to configure • M to return', 25, H_ - 40)
    
    // Error message
    if (labError) {
        ctx2d.fillStyle = '#ff5f7e'
        ctx2d.font = '10px monospace'
        const lines = labError.split('\n')
        let y = H_ - 80
        for (const line of lines) {
            ctx2d.fillText(line.substring(0, 40), 25, y)
            y += 14
        }
    }
    
    ctx2d.textAlign = 'left'
}

// ─────────────────────────────────────────────────────
//  HUD
// ─────────────────────────────────────────────────────
function buildScrollBar() {
    const bar = document.getElementById('scroll-bar')
    bar.innerHTML = ''
    scrollSrc.forEach((s, i) => {
        const locked = s === null, hasErr = !!scrollErrors[i]
        const slot = document.createElement('div')
        slot.className = 'scroll-slot' + (i === selectedScroll ? ' active' : '') + (locked ? ' empty' : '')
        slot.style.borderColor = i === selectedScroll && !locked ? SCROLL_META[i].color : ''
        slot.innerHTML = `<span class="skey">${i + 1}</span>` +
            (locked ? `<span class="sname" style="color:#3a3458">locked</span>`
                : `<span class="sname">${SCROLL_META[i].name}</span>${hasErr ? '<span class="serr">!</span>' : ''}`)
        if (!locked) slot.addEventListener('click', () => { selectedScroll = i; buildScrollBar() })
        bar.appendChild(slot)
    })
}

let msgTimer = null
function showMsg(txt) {
    const el = document.getElementById('msg')
    el.textContent = txt; el.style.opacity = '1'
    const cr = canvas.getBoundingClientRect()
    el.style.top = (cr.top + canvas.height / 2 - 20) + 'px'
    el.style.left = (cr.left + canvas.width / 2) + 'px'
    el.style.transform = 'translateX(-50%)'
    if (msgTimer) clearTimeout(msgTimer)
    msgTimer = setTimeout(() => el.style.opacity = '0', 1800)
}

// ─────────────────────────────────────────────────────
//  INPUT
// ─────────────────────────────────────────────────────
window.addEventListener('keydown', e => {
    keys[e.key.toLowerCase()] = true
    
    // Pause toggle (ESC or P)
    if ((e.key === 'Escape' || e.key.toLowerCase() === 'p') && (gameState === 'play' || gameState === 'paused')) {
        if (gameState === 'play') {
            gameState = 'paused'
        } else {
            gameState = 'play'
        }
        return
    }
    
    if (gameState === 'crafting') return
    if (gameState === 'paused') return
    
    if (gameState === 'menu' && (e.key === 'Enter' || e.key === ' ')) {
        startGame()
        return
    }
    if (gameState === 'menu' && e.key.toLowerCase() === 'l') {
        openLab()
        return
    }
    if (gameState === 'lab' && e.key.toLowerCase() === 'm') {
        gameState = 'menu'
        return
    }
    if (gameState === 'dead' && (e.key === 'Enter' || e.key === ' ')) {
        gameState = 'menu'
        return
    }
    if (['1', '2', '3', '4'].includes(e.key)) {
        const i = parseInt(e.key) - 1
        if (scrollSrc[i] !== null) { selectedScroll = i; buildScrollBar() }
    }
    if (e.key === ' ') e.preventDefault()
})
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false })
canvas.addEventListener('mousemove', e => {
    const r = canvas.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top
})
canvas.addEventListener('click', e => { //CAST SPELLS
    if (gameState === 'menu' || gameState === 'dead') {
        gameState = 'menu'
        startGame()
        return
    }
    if (gameState === 'paused') {
        // Check if clicking on pause menu buttons
        const r = canvas.getBoundingClientRect()
        const mx = e.clientX - r.left
        const my = e.clientY - r.top
        const W_ = W(), H_ = H()
        
        // Resume button
        if (mx > W_/2 - 80 && mx < W_/2 + 80 && my > H_/2 - 20 && my < H_/2 + 20) {
            gameState = 'play'
            return
        }
        // Quit to menu button
        if (mx > W_/2 - 80 && mx < W_/2 + 80 && my > H_/2 + 30 && my < H_/2 + 70) {
            gameState = 'menu'
            return
        }
        return
    }
    if (gameState === 'lab') {
        const r = canvas.getBoundingClientRect()
        const mx = e.clientX - r.left
        const my = e.clientY - r.top
        
        // Check button clicks in the lab panel
        // Shape buttons
        const shapes = ['ball', 'cone', 'beam', 'nova', 'wall']
        let sx = 25 + 10  // panel offset
        for (const shape of shapes) {
            const btnW = 50, btnH = 22
            if (mx >= sx && mx <= sx + btnW && my >= 132 && my <= 132 + btnH) {
                labSpellShape = labSpellShape === shape ? null : shape
                return
            }
            sx += btnW + 5
        }
        
        // Attribute buttons
        const attrs = ['fire', 'ice', 'light', 'shadow', 'arcane', 'void']
        let ax = 25 + 10
        for (const attr of attrs) {
            const btnW = 48, btnH = 22
            if (mx >= ax && mx <= ax + btnW && my >= 187 && my <= 187 + btnH) {
                labSpellAttribute = labSpellAttribute === attr ? null : attr
                return
            }
            ax += btnW + 4
        }
        
        // Speed slider click
        if (mx >= 35 && mx <= 235 && my >= 240 && my <= 252) {
            labSpellSpeed = Math.round(((mx - 35) / 200) * 10)
            labSpellSpeed = Math.max(1, Math.min(10, labSpellSpeed))
            return
        }
        
        // Size slider click
        if (mx >= 35 && mx <= 135 && my >= 280 && my <= 292) {
            labSpellSize = Math.round(((mx - 35) / 100) * 4) + 1
            labSpellSize = Math.max(1, Math.min(5, labSpellSize))
            return
        }
        
        // Follow toggle
        if (mx >= 150 && mx <= 200 && my >= 308 && my <= 328) {
            labSpellFollow = !labSpellFollow
            return
        }
        
        // Cast spell on canvas area (outside panel)
        if (mx > 340) {
            castLabSpell(mx, my)
        }
        return
    }
    if (gameState !== 'play') return
    const r = canvas.getBoundingClientRect()
    castSpell(e.clientX - r.left, e.clientY - r.top)
})
canvas.addEventListener('wheel', e => {
    if (gameState !== 'play') return
    e.preventDefault()
    let next = (selectedScroll + (e.deltaY > 0 ? 1 : -1) + 4) % 4
    while (scrollSrc[next] === null) next = (next + (e.deltaY > 0 ? 1 : -1) + 4) % 4
    selectedScroll = next; buildScrollBar()
}, { passive: false })

// ─────────────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────────────
function saveSpells() {
    localStorage.setItem('arcane_saved_spells', JSON.stringify(savedSpells))
}

function startGame() {
    gameState = 'play'
    player.x = W() / 2; player.y = H() / 2
    buildScrollBar()
    startWave(1)
}


function resetGame() {
    player.hp = player.maxHp = 100; player.invincible = 0
    pool.mana = pool.maxMana = 500; pool.regenRate = 20; pool.costMult = 1; pool.manaOnKill = 0
    scrollSrc = DEFAULT_SRC.map(s => s)
    scrollErrors = [null, null, null, null]
    selectedScroll = 0
    enemies = []
    projectiles = []
    particles = []

    score = 0; waveNum = 0; chosenUpgradeIds = []
    startGame()
}

function openLab() {
    gameState = 'lab'
    initLab()
}


gameState = 'menu'
requestAnimationFrame(ts => { lastTime = ts; update(ts) })

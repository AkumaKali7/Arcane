// ─── Core Constants and Configurations ──────────────────────────────────────

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
 * Attribute colors for rendering
 */
const ATTR_COLOR = {
    fire: '#ff6b35',
    light: '#bdbd17',
    ice: '#80deea',
    shadow: '#59375f',
    arcane: '#b39ddb',
    void: '#210021',
}

/**
 * Scroll metadata for UI
 */
const SCROLL_META = [
    { name: 'Fireball', color: '#ff6b35' },
    { name: 'Ice Beam', color: '#80deea' },
    { name: 'Shadow Nova', color: '#ce93d8' },
    { name: 'Scroll 4', color: '#b39ddb' },
]

/**
 * Default scroll sources
 */
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

    `gather(env, 200)
shape("nova")
attribute("shadow")
reserve(150)
on_deplete(fn()
  explode()
end)`,

    null  // 4th slot locked
]

/**
 * Enemy type definitions
 */
const ENEMY_TYPES = {
    basic: { hp: 25, spd: 36, r: 12, color: '#b43250' },
    tank: { hp: 60, spd: 18, r: 18, color: '#8b2252' },
    swift: { hp: 15, spd: 72, r: 8, color: '#ff6b9d' },
    caster: { hp: 20, spd: 28, r: 14, color: '#9b59b6' }
}

/**
 * Available upgrades
 */
const ALL_UPGRADES = [
    { id: 'mana', title: '+100 Max Mana', desc: 'Permanently expand your mana pool.', apply: () => { pool.maxMana += 100; pool.mana = Math.min(pool.mana + 100, pool.maxMana) } },
    { id: 'regen', title: '+25% Mana Regen', desc: 'Your mana recovers faster between casts.', apply: () => { pool.regenRate *= 1.25 } },
    { id: 'slot', title: '4th Scroll Slot', desc: 'Unlock a fourth spell slot to write freely.', apply: () => { if (scrollSrc[3] === null) scrollSrc[3] = 'gather(pool, 80)\nshape("ball")\nattribute("arcane")\nspeed(5)' }, once: true },
    { id: 'cost', title: '-10% Spell Costs', desc: 'All gather amounts cost 10% less mana.', apply: () => { pool.costMult = Math.max(0.3, pool.costMult - 0.10) } },
    { id: 'hp', title: 'Restore + Max HP', desc: 'Heal to full and gain +20 max HP.', apply: () => { player.maxHp += 20; player.hp = player.maxHp } },
    { id: 'kill', title: 'Mana on Kill', desc: 'Each enemy death restores mana.', apply: () => { pool.manaOnKill += 8 } },
]

/**
 * Keys that belong to the spell context (filtered from user vars panel)
 */
const SPELL_CONTEXT_KEYS = new Set([
    'pool', 'env',
    'gather', 'shape', 'attribute', 'speed', 'follow', 'reserve', 'explode', 'cast',
    'on_hit', 'on_deplete', 'on_check', 'on_low_mana',
    'mana_pool', 'self_mana', 'self_reserved', 'enemy_nearby', 'resize',
    'log', 'print',
    'rand', 'floor', 'ceil', 'round', 'abs', 'min', 'max', 'str', 'num',
])

// ─── Game Entity Classes ──────────────────────────────────────────────────────

/**
 * Mana pool for the player
 */
class Pool {
    constructor(mana = 500, maxMana = 500, regenRate = 20, costMult = 1, manaOnKill = 0) {
        this.mana = mana
        this.maxMana = maxMana
        this.regenRate = regenRate
        this.costMult = costMult
        this.manaOnKill = manaOnKill
    }
}

/**
 * Player character
 */
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

/**
 * Spell projectile
 */
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

/**
 * Enemy entity
 */
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

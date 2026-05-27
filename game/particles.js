// ─── Particle System ─────────────────────────────────────────────────────────

/**
 * Spawn explosion particles
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {string} color - Particle color
 * @param {number} count - Number of particles
 * @param {number} spd - Speed multiplier
 * @param {number} life - Lifetime in seconds
 */
function spawnParticles(x, y, color, count, spd, life) {
    for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2, s = spd * (0.4 + Math.random() * 0.6)
        particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, color, life, maxLife: life, r: 2 + Math.random() * 3 })
    }
}

/**
 * Spawn an explosion effect with ring
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {string} color - Explosion color
 * @param {number} radius - Explosion radius
 */
function spawnExplosion(x, y, color, radius) {
    spawnParticles(x, y, color, 18, 200, 0.5)
    particles.push({ type: 'ring', x, y, r: 0, maxR: radius, color, life: 0.4, maxLife: 0.4 })
}

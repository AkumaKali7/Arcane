// ─── Wave Management System ──────────────────────────────────────────────────

let waveNum = 0
let waveEnemiesLeft = 0
let batchTimer = 0
let batchQueue = []

/**
 * Start a new wave of enemies
 * @param {number} n - Wave number
 */
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

/**
 * Spawn a batch of enemies
 */
function spawnBatch() {
    if (!batchQueue.length) return
    const count = batchQueue.shift()
    for (let i = 0; i < count; i++) spawnEnemy()
}

/**
 * Spawn a single enemy at a random edge position
 */
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

/**
 * Check if the current wave is complete
 */
function checkWaveComplete() {
    if (waveEnemiesLeft <= 0 && enemies.length === 0 && batchQueue.length === 0)
        openCraftScreen()
}

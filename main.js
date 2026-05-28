// ─── Main Game Loop and Rendering ────────────────────────────────────────────
// This is the main entry point that ties all modules together

// Canvas setup
const canvas = document.getElementById('c')
const ctx2d = canvas.getContext('2d')

function resize() {
    const margin = 80, maxW = Math.min(window.innerWidth - 32, 700), maxH = Math.min(window.innerHeight - margin, 520)
    canvas.width = canvas.height = Math.min(maxW, maxH)
}
resize(); window.addEventListener('resize', resize)
const W = () => canvas.width, H = () => canvas.height
const WALL = 24

// Global game state
let enemies = [], projectiles = [], particles = [], spells = []
let mouse = { x: 0, y: 0 }, keys = {}
let score = 0, lastTime = 0
let gameState = 'menu'   // play | crafting | dead | menu | lab | paused

// Scroll state
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

// Lab state
let labSrc = 'gather(pool, 50)\nshape("ball")\nattribute("fire")\nspeed(5)'
let labError = null
let labDummy = null
let labProjectile = null
let labEngine = null

// Crafting state
let craftActiveTab = 0, pendingSrcs = [], craftUpgrades = [], chosenUpgrade = null

// Upgrades state
let chosenUpgradeIds = []

// UI button state
let menuButtons = null
let pauseButtons = null

function pickUpgrades() {
    const avail = ALL_UPGRADES.filter(u => !(u.once && chosenUpgradeIds.includes(u.id)))
    return [...avail].sort(() => Math.random() - 0.5).slice(0, 3)
}

// Message display
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

// Drawing functions
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

function drawDead() {
    const W_ = W(), H_ = H()
    
    ctx2d.fillStyle = 'rgba(10,10,15,0.92)'
    ctx2d.fillRect(0, 0, W_, H_)
    
    ctx2d.textAlign = 'center'
    ctx2d.font = 'bold 48px monospace'
    ctx2d.fillStyle = '#ff5f7e'
    ctx2d.fillText('YOU LOST', W_ / 2, H_ / 2 - 60)
    
    ctx2d.font = '16px monospace'
    ctx2d.fillStyle = '#c8c0e0'
    ctx2d.fillText('Wave Reached: ' + waveNum, W_ / 2, H_ / 2 - 10)
    ctx2d.fillText('Final Score: ' + score, W_ / 2, H_ / 2 + 15)
    
    ctx2d.font = 'bold 18px monospace'
    ctx2d.fillStyle = '#9b7aff'
    ctx2d.fillText('CLICK TO RETURN TO MENU', W_ / 2, H_ / 2 + 60)
    
    ctx2d.textAlign = 'left'
}

// drawMenu function has been moved to ui/ui_manager.js
// The function is now defined in the UI manager module

function drawLab() {
    const W_ = W(), H_ = H()
    
    ctx2d.fillStyle = '#0d0d1a'
    ctx2d.fillRect(0, 0, W_, H_)
    
    ctx2d.strokeStyle = '#1a1a2e'
    ctx2d.lineWidth = 1
    for (let x = 0; x < W_; x += 40) { ctx2d.beginPath(); ctx2d.moveTo(x, 0); ctx2d.lineTo(x, H_); ctx2d.stroke() }
    for (let y = 0; y < H_; y += 40) { ctx2d.beginPath(); ctx2d.moveTo(0, y); ctx2d.lineTo(W_, y); ctx2d.stroke() }
    
    if (labDummy) {
        ctx2d.beginPath()
        ctx2d.arc(labDummy.x, labDummy.y, labDummy.r, 0, Math.PI * 2)
        ctx2d.fillStyle = '#3a3a5a'
        ctx2d.fill()
        ctx2d.strokeStyle = '#6a6a9a'
        ctx2d.lineWidth = 2
        ctx2d.stroke()
        
        const hpPct = labDummy.hp / labDummy.maxHp
        ctx2d.fillStyle = '#1a1a2e'
        ctx2d.fillRect(labDummy.x - 20, labDummy.y - labDummy.r - 12, 40, 6)
        ctx2d.fillStyle = hpPct > 0.5 ? '#66d9a0' : hpPct > 0.25 ? '#ffb347' : '#ff5f7e'
        ctx2d.fillRect(labDummy.x - 20, labDummy.y - labDummy.r - 12, 40 * hpPct, 6)
        
        ctx2d.font = '8px monospace'
        ctx2d.fillStyle = '#aaaacc'
        ctx2d.textAlign = 'center'
        ctx2d.fillText(Math.floor(labDummy.hp) + '/' + labDummy.maxHp, labDummy.x, labDummy.y - labDummy.r - 15)
        ctx2d.textAlign = 'left'
    }
    
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
    
    ctx2d.fillStyle = 'rgba(15, 15, 30, 0.95)'
    ctx2d.fillRect(10, 10, 280, H_ - 20)
    ctx2d.strokeStyle = '#3a3a5a'
    ctx2d.lineWidth = 1
    ctx2d.strokeRect(10, 10, 280, H_ - 20)
    
    ctx2d.font = 'bold 16px monospace'
    ctx2d.fillStyle = '#9b7aff'
    ctx2d.fillText('SPELL LAB', 25, 35)
    
    ctx2d.font = '11px monospace'
    ctx2d.fillStyle = '#8a8aac'
    ctx2d.fillText('Edit spell • Click canvas to cast', 25, 52)
    
    ctx2d.font = '10px monospace'
    ctx2d.fillStyle = '#6a6a8a'
    ctx2d.fillText('━━━━━━━━━━━━━━━━━━━━━━', 25, 70)
    
    if (labEngine) {
        ctx2d.fillStyle = '#aaaacc'
        ctx2d.fillText('Shape: ' + (labEngine.spellShape || 'none'), 25, 88)
        ctx2d.fillText('Attr: ' + (labEngine.attributes.join(', ') || 'none'), 25, 102)
        ctx2d.fillText('Speed: ' + labEngine.spellSpeed.toFixed(1), 25, 116)
        ctx2d.fillText('Size: ' + labEngine.size, 25, 130)
        ctx2d.fillText('Drain: ' + labEngine.drainRate.toFixed(1) + '/s', 25, 144)
        ctx2d.fillText('Phase: ' + labEngine.phase, 25, 158)
        ctx2d.fillText('Mana: ' + Math.floor(labEngine.mana), 25, 172)
    } else {
        ctx2d.fillStyle = '#6a6a8a'
        ctx2d.fillText('No active spell', 25, 88)
    }
    
    ctx2d.fillStyle = '#6a6a8a'
    ctx2d.fillText('━━━━━━━━━━━━━━━━━━━━━━', 25, 190)
    ctx2d.fillStyle = '#4a9a6a'
    ctx2d.fillText('INFINITE MANA', 25, 208)
    
    if (labError) {
        ctx2d.fillStyle = '#ff5f7e'
        ctx2d.font = '10px monospace'
        const lines = labError.split('\n')
        let y = 230
        for (const line of lines) {
            ctx2d.fillText(line.substring(0, 35), 25, y)
            y += 14
        }
    }
    
    ctx2d.textAlign = 'left'
}

// Lab functions - initLab moved to ui_manager.js, keeping updateLab and castLabSpell here

function updateLab(dt) {
    if (labDummy && labDummy.hp <= 0) {
        labDummy.hp = labDummy.maxHp
    }
    
    if (labProjectile && labEngine) {
        labEngine.tick(dt)
        
        if (labEngine.phase === 'active' && labProjectile.alive) {
            const p = labProjectile
            p.x += p.vx * dt
            p.y += p.vy * dt
            
            const dx = p.x - labDummy.x
            const dy = p.y - labDummy.y
            const dist = Math.sqrt(dx * dx + dy * dy)
            
            if (dist < p.r + labDummy.r) {
                const dmg = Math.floor(5 * Math.sqrt(labEngine.reserved) || 10)
                labDummy.hp = Math.max(0, labDummy.hp - dmg)
                spawnParticles(p.x, p.y, ATTR_COLOR[labEngine.attributes[0]] || '#a87fd4', 12, 150, 0.3)
                p.alive = false
                labEngine.phase = 'dead'
            }
            
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
    if (labProjectile) {
        labProjectile.alive = false
        labProjectile = null
        labEngine = null
    }
    
    try {
        const parser = new Parser(labSrc)
        const ast = parser.parse()
        
        if (!ast) {
            labError = 'Failed to parse spell'
            return
        }
        
        labError = null
        
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

// Update loop
function update(ts) {
    const dt = Math.min((ts - lastTime) / 1000, 0.05)
    lastTime = ts

    if (gameState === 'dead') { drawDead(); requestAnimationFrame(update); return }
    if (gameState === 'crafting') { requestAnimationFrame(update); return }
    if (gameState === 'menu') { drawMenu(); requestAnimationFrame(update); return }
    if (gameState === 'paused') { draw(); drawPauseOverlay(); requestAnimationFrame(update); return }
    if (gameState === 'lab') { 
        // Save spells periodically
        if (Math.random() < 0.01) saveSpellsToStorage()
        updateLab(dt); drawLab(); requestAnimationFrame(update); return 
    }

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
    
    // Auto-save spells occasionally during gameplay
    if (Math.random() < 0.005) saveSpellsToStorage()
    
    requestAnimationFrame(update)
}

// UI Functions
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
        `wave ${waveNum} complete · edit your scrolls · choose an upgrade`
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

function startGame() {
    gameState = 'play'
    player.x = W() / 2; player.y = H() / 2
    buildScrollBar()
    startWave(1)
}

function resetGame() {
    player.hp = player.maxHp = 100; player.invincible = 0
    pool.mana = pool.maxMana = 500; pool.regenRate = 20; pool.costMult = 1; pool.manaOnKill = 0
    // Try to load saved spells, otherwise use defaults
    if (!loadSpellsFromStorage()) {
        scrollSrc = DEFAULT_SRC.map(s => s)
    }
    scrollErrors = [null, null, null, null]
    selectedScroll = 0
    enemies = [];
    projectiles = [];
    particles = [];

    score = 0; waveNum = 0; chosenUpgradeIds = []
    startGame()
}

// openLab function has been moved to ui/ui_manager.js

// Initialize global instances
const pool = new Pool()
const player = new Player()

// Input handlers
window.addEventListener('keydown', e => {
    keys[e.key.toLowerCase()] = true
    if (gameState === 'crafting') return
    
    // Pause toggle with ESC or P
    if ((e.key === 'Escape' || e.key.toLowerCase() === 'p') && gameState === 'play') {
        gameState = 'paused'
        return
    }
    
    // Resume from pause
    if ((e.key === 'Escape' || e.key.toLowerCase() === 'p') && gameState === 'paused') {
        gameState = 'play'
        return
    }
    
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
    // TAB to open spell lab from gameplay or toggle editor when in lab
    if (e.key === 'Tab') {
        e.preventDefault()
        if (gameState === 'play') {
            openLab()
        } else if (gameState === 'lab') {
            toggleLabEditor()
        }
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
canvas.addEventListener('click', e => {
    if (gameState === 'menu') {
        const r = canvas.getBoundingClientRect()
        const x = e.clientX - r.left
        const y = e.clientY - r.top
        if (!handleMenuClick(x, y)) {
            startGame()
        }
        return
    }
    if (gameState === 'dead') {
        gameState = 'menu'
        return
    }
    if (gameState === 'paused') {
        const r = canvas.getBoundingClientRect()
        const x = e.clientX - r.left
        const y = e.clientY - r.top
        handlePauseClick(x, y)
        return
    }
    if (gameState === 'lab') {
        const r = canvas.getBoundingClientRect()
        castLabSpell(e.clientX - r.left, e.clientY - r.top)
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

// Craft editor events
document.getElementById('craft-editor').addEventListener('input', () => { 
    updateLineNums(); 
    if (gameState === 'lab') { saveLabSpell(); } else { validateTab(); saveTab(); }
})
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
// Save spells when closing craft screen
document.getElementById('btn-next-wave').addEventListener('click', () => {
    saveTab()
    scrollSrc = pendingSrcs.map((s, i) => scrollSrc[i] === null ? null : s)
    scrollAST = scrollSrc.map((s, i) => {
        let ast = ''
        if (s) {
            const tokens = lex(s)
            ast = new Parser(tokens).parse()
        }
        return scrollSrc[i] === null ? null : ast
    })
    if (chosenUpgrade) { chosenUpgrade.apply(); chosenUpgradeIds.push(chosenUpgrade.id) }
    // Save spells to localStorage
    saveSpellsToStorage()
    closeCraftScreen()
    projectiles = []; particles = []
    player.hp = Math.min(player.maxHp, player.hp + 20)
    pool.mana = pool.maxMana
    buildScrollBar()
    gameState = 'play'
    startWave(waveNum + 1)
})

// Boot
gameState = 'menu'
requestAnimationFrame(update)

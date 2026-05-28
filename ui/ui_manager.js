// ─── UI Management Module ────────────────────────────────────────────────────
// Handles all UI screens, menus, pause functionality, and spell persistence

// Storage keys
const STORAGE_KEY_SPELLS = 'arcane_spellforge_spells'
const STORAGE_KEY_UPGRADES = 'arcane_spellforge_upgrades'

/**
 * Save spells to localStorage
 */
function saveSpellsToStorage() {
    try {
        const data = {
            scrolls: scrollSrc,
            timestamp: Date.now()
        }
        localStorage.setItem(STORAGE_KEY_SPELLS, JSON.stringify(data))
    } catch (e) {
        console.warn('Failed to save spells:', e)
    }
}

/**
 * Load spells from localStorage
 * @returns {boolean} true if loaded successfully
 */
function loadSpellsFromStorage() {
    try {
        const data = localStorage.getItem(STORAGE_KEY_SPELLS)
        if (!data) return false
        const parsed = JSON.parse(data)
        if (parsed.scrolls && Array.isArray(parsed.scrolls)) {
            // Ensure we have exactly 4 slots
            while (parsed.scrolls.length < 4) parsed.scrolls.push(null)
            scrollSrc = parsed.scrolls.slice(0, 4)
            return true
        }
        return false
    } catch (e) {
        console.warn('Failed to load spells:', e)
        return false
    }
}

/**
 * Save game progress (upgrades) to localStorage
 */
function saveProgressToStorage() {
    try {
        const data = {
            chosenUpgradeIds: chosenUpgradeIds,
            maxMana: pool.maxMana,
            regenRate: pool.regenRate,
            costMult: pool.costMult,
            manaOnKill: pool.manaOnKill,
            maxHp: player.maxHp,
            timestamp: Date.now()
        }
        localStorage.setItem(STORAGE_KEY_UPGRADES, JSON.stringify(data))
    } catch (e) {
        console.warn('Failed to save progress:', e)
    }
}

/**
 * Clear all saved data
 */
function clearSavedData() {
    localStorage.removeItem(STORAGE_KEY_SPELLS)
    localStorage.removeItem(STORAGE_KEY_UPGRADES)
}

/**
 * Draw the main menu with clickable buttons
 */
function drawMenu() {
    const W_ = W(), H_ = H()
    
    const grad = ctx2d.createLinearGradient(0, 0, 0, H_)
    grad.addColorStop(0, '#0a0a12')
    grad.addColorStop(1, '#1a1a2e')
    ctx2d.fillStyle = grad
    ctx2d.fillRect(0, 0, W_, H_)
    
    ctx2d.textAlign = 'center'
    ctx2d.font = 'bold 48px monospace'
    ctx2d.fillStyle = '#9b7aff'
    ctx2d.fillText('ARCANE SPELLFORGE', W_ / 2, H_ / 2 - 120)
    
    ctx2d.font = '16px monospace'
    ctx2d.fillStyle = '#6a5a8a'
    ctx2d.fillText('Craft spells • Survive waves • Master mana', W_ / 2, H_ / 2 - 90)
    
    // Menu buttons
    const btnWidth = 220
    const btnHeight = 50
    const btnX = W_ / 2 - btnWidth / 2
    
    // Play button
    const playBtnY = H_ / 2 - 30
    const playHovered = mouse.x >= btnX && mouse.x <= btnX + btnWidth && 
                        mouse.y >= playBtnY && mouse.y <= playBtnY + btnHeight
    
    ctx2d.fillStyle = playHovered ? '#7a5fbf' : '#5a3f9f'
    ctx2d.fillRect(btnX, playBtnY, btnWidth, btnHeight)
    ctx2d.strokeStyle = '#9b7aff'
    ctx2d.lineWidth = 2
    ctx2d.strokeRect(btnX, playBtnY, btnWidth, btnHeight)
    
    ctx2d.font = 'bold 20px monospace'
    ctx2d.fillStyle = '#ffffff'
    ctx2d.fillText('▶ PLAY', W_ / 2, playBtnY + 32)
    
    // Lab button
    const labBtnY = H_ / 2 + 40
    const labHovered = mouse.x >= btnX && mouse.x <= btnX + btnWidth && 
                       mouse.y >= labBtnY && mouse.y <= labBtnY + btnHeight
    
    ctx2d.fillStyle = labHovered ? '#7a5fbf' : '#5a3f9f'
    ctx2d.fillRect(btnX, labBtnY, btnWidth, btnHeight)
    ctx2d.strokeStyle = '#9b7aff'
    ctx2d.lineWidth = 2
    ctx2d.strokeRect(btnX, labBtnY, btnWidth, btnHeight)
    
    ctx2d.font = 'bold 20px monospace'
    ctx2d.fillStyle = '#ffffff'
    ctx2d.fillText('⚗ SPELL LAB', W_ / 2, labBtnY + 32)
    
    // Controls info
    ctx2d.font = '12px monospace'
    ctx2d.fillStyle = '#4a4465'
    ctx2d.fillText('WASD/Arrows to move • Edit scrolls between waves', W_ / 2, H_ / 2 + 110)
    
    // Check for saved spells indicator
    const hasSavedSpells = localStorage.getItem(STORAGE_KEY_SPELLS) !== null
    if (hasSavedSpells) {
        ctx2d.font = '10px monospace'
        ctx2d.fillStyle = '#6a6a8a'
        ctx2d.fillText('☑ Saved spells found', W_ / 2, H_ / 2 + 130)
    }
    
    ctx2d.textAlign = 'left'
    
    // Store button positions for click handling
    menuButtons = {
        play: { x: btnX, y: playBtnY, w: btnWidth, h: btnHeight },
        lab: { x: btnX, y: labBtnY, w: btnWidth, h: btnHeight }
    }
}

/**
 * Draw pause screen overlay
 */
function drawPauseOverlay() {
    const W_ = W(), H_ = H()
    
    // Semi-transparent overlay
    ctx2d.fillStyle = 'rgba(10, 10, 20, 0.85)'
    ctx2d.fillRect(0, 0, W_, H_)
    
    ctx2d.textAlign = 'center'
    ctx2d.font = 'bold 42px monospace'
    ctx2d.fillStyle = '#9b7aff'
    ctx2d.fillText('PAUSED', W_ / 2, H_ / 2 - 80)
    
    // Buttons
    const btnWidth = 200
    const btnHeight = 45
    const btnX = W_ / 2 - btnWidth / 2
    
    // Resume button
    const resumeBtnY = H_ / 2 - 20
    const resumeHovered = mouse.x >= btnX && mouse.x <= btnX + btnWidth && 
                          mouse.y >= resumeBtnY && mouse.y <= resumeBtnY + btnHeight
    
    ctx2d.fillStyle = resumeHovered ? '#7a5fbf' : '#5a3f9f'
    ctx2d.fillRect(btnX, resumeBtnY, btnWidth, btnHeight)
    ctx2d.strokeStyle = '#9b7aff'
    ctx2d.lineWidth = 2
    ctx2d.strokeRect(btnX, resumeBtnY, btnWidth, btnHeight)
    
    ctx2d.font = 'bold 18px monospace'
    ctx2d.fillStyle = '#ffffff'
    ctx2d.fillText('RESUME', W_ / 2, resumeBtnY + 29)
    
    // Lab button
    const labBtnY = H_ / 2 + 40
    const labHovered = mouse.x >= btnX && mouse.x <= btnX + btnWidth && 
                       mouse.y >= labBtnY && mouse.y <= labBtnY + btnHeight
    
    ctx2d.fillStyle = labHovered ? '#7a5fbf' : '#5a3f9f'
    ctx2d.fillRect(btnX, labBtnY, btnWidth, btnHeight)
    ctx2d.strokeStyle = '#9b7aff'
    ctx2d.lineWidth = 2
    ctx2d.strokeRect(btnX, labBtnY, btnWidth, btnHeight)
    
    ctx2d.font = 'bold 18px monospace'
    ctx2d.fillStyle = '#ffffff'
    ctx2d.fillText('SPELL LAB', W_ / 2, labBtnY + 29)
    
    // Main Menu button
    const menuBtnY = H_ / 2 + 100
    const menuHovered = mouse.x >= btnX && mouse.x <= btnX + btnWidth && 
                        mouse.y >= menuBtnY && mouse.y <= menuBtnY + btnHeight
    
    ctx2d.fillStyle = menuHovered ? '#9f3f5a' : '#7f2f4a'
    ctx2d.fillRect(btnX, menuBtnY, btnWidth, btnHeight)
    ctx2d.strokeStyle = '#ff5f7e'
    ctx2d.lineWidth = 2
    ctx2d.strokeRect(btnX, menuBtnY, btnWidth, btnHeight)
    
    ctx2d.font = 'bold 18px monospace'
    ctx2d.fillStyle = '#ffffff'
    ctx2d.fillText('MAIN MENU', W_ / 2, menuBtnY + 29)
    
    ctx2d.textAlign = 'left'
    
    // Store button positions
    pauseButtons = {
        resume: { x: btnX, y: resumeBtnY, w: btnWidth, h: btnHeight },
        lab: { x: btnX, y: labBtnY, w: btnWidth, h: btnHeight },
        menu: { x: btnX, y: menuBtnY, w: btnWidth, h: btnHeight }
    }
}

/**
 * Handle menu button clicks
 */
function handleMenuClick(x, y) {
    if (!menuButtons) return
    
    if (x >= menuButtons.play.x && x <= menuButtons.play.x + menuButtons.play.w &&
        y >= menuButtons.play.y && y <= menuButtons.play.y + menuButtons.play.h) {
        startGame()
        return true
    }
    
    if (x >= menuButtons.lab.x && x <= menuButtons.lab.x + menuButtons.lab.w &&
        y >= menuButtons.lab.y && y <= menuButtons.lab.y + menuButtons.lab.h) {
        openLab()
        return true
    }
    
    return false
}

/**
 * Handle pause screen button clicks
 */
function handlePauseClick(x, y) {
    if (!pauseButtons) return false
    
    if (x >= pauseButtons.resume.x && x <= pauseButtons.resume.x + pauseButtons.resume.w &&
        y >= pauseButtons.resume.y && y <= pauseButtons.resume.y + pauseButtons.resume.h) {
        gameState = 'play'
        return true
    }
    
    if (x >= pauseButtons.lab.x && x <= pauseButtons.lab.x + pauseButtons.lab.w &&
        y >= pauseButtons.lab.y && y <= pauseButtons.lab.y + pauseButtons.lab.h) {
        openLab()
        return true
    }
    
    if (x >= pauseButtons.menu.x && x <= pauseButtons.menu.x + pauseButtons.menu.w &&
        y >= pauseButtons.menu.y && y <= pauseButtons.menu.y + pauseButtons.menu.h) {
        gameState = 'menu'
        projectiles = []
        enemies = []
        particles = []
        return true
    }
    
    return false
}

/**
 * Initialize lab state with default spells
 */
function initLab() {
    // Use default spells for lab
    labDummy = { x: W() / 2 + 100, y: H() / 2, r: 25, hp: 1000, maxHp: 1000, stationary: true }
    labProjectile = null
    labEngine = null
    labError = null
    labSrc = DEFAULT_SRC[0] || ''
}

/**
 * Open spell lab - identical to crafting window but accessible anytime
 */
function openLab() {
    gameState = 'lab'
    initLab()
    // Show the craft screen UI with editor hidden initially
    document.getElementById('craft-screen').classList.add('open')
    document.getElementById('editor-wrap-craft').style.display = 'none'
}

/**
 * Close spell lab and return to previous state
 */
function closeLab() {
    gameState = 'play'
    document.getElementById('craft-screen').classList.remove('open')
    document.getElementById('editor-wrap-craft').style.display = 'none'
}

/**
 * Toggle spell editor in lab (TAB key)
 */
function toggleLabEditor() {
    if (gameState !== 'lab') return
    
    const editorWrap = document.getElementById('editor-wrap-craft')
    if (editorWrap.style.display === 'none' || editorWrap.style.display === '') {
        // Open editor - make it identical to crafting window
        editorWrap.style.display = 'block'
        document.getElementById('craft-screen').classList.add('open')
        document.getElementById('upgrade-section').style.display = 'none'
        document.getElementById('craft-footer').innerHTML = `
            <button class="btn-craft" id="btn-save-lab">✓ SAVE SPELL</button>
            <button class="btn-craft" id="btn-close-lab">✕ CLOSE LAB</button>
        `
        document.getElementById('btn-save-lab').addEventListener('click', () => {
            saveLabSpell()
        })
        document.getElementById('btn-close-lab').addEventListener('click', () => {
            closeLab()
            document.getElementById('craft-screen').classList.remove('open')
        })
        
        // Load current lab spell into editor
        document.getElementById('craft-editor').value = labSrc
        updateLineNums()
        validateLabSpell()
    } else {
        // Close editor
        editorWrap.style.display = 'none'
        document.getElementById('craft-screen').classList.remove('open')
    }
}

/**
 * Validate lab spell
 */
function validateLabSpell() {
    const src = document.getElementById('craft-editor').value
    const err = tryCompile(src)
    labError = err
    document.getElementById('craft-error').textContent = err || ''
}

/**
 * Save lab spell from editor
 */
function saveLabSpell() {
    labSrc = document.getElementById('craft-editor').value
    validateLabSpell()
}

/**
 * Handle menu button hover effects
 */
function updateMenuHover() {
    // Redraw will handle hover based on current mouse position
}

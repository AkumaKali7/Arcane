# Arcane Spellforge

A spell-crafting survival game where you design custom spells using a scripting language and battle endless waves of enemies.

## 🎮 How to Play

### Getting Started
1. **Start Screen**: When the game loads, you'll see the main menu with your high score displayed
2. **Begin**: Click anywhere or press `Enter`/`Space` to start your first wave
3. **Survive**: Defeat enemies and progress through increasingly difficult waves

### Controls
- **Movement**: `WASD` or `Arrow Keys`
- **Cast Spells**: Mouse click at target location
- **Select Scroll**: Keys `1-4` or click on scroll slots
- **Cycle Scrolls**: Mouse wheel (during gameplay)
- **Start Game**: `Enter`, `Space`, or Click (on menu/death screen)
- **Pause Game**: `ESC` or `P` (during gameplay)
- **Open Spell Lab**: `L` (from main menu)
- **Return to Menu**: `M` (from Spell Lab)

### Spell Crafting
Between waves, you can edit your spell scrolls using the Arcane scripting language. Each scroll can contain a unique spell definition.

#### Basic Spell Structure
```javascript
gather(pool, 100)
shape("ball", 2)
attribute("fire")
speed(5)
on_hit(() => {
    // Effect when hitting enemy
})
```

#### Available Commands
- `gather(source, amount)` - Collect mana from 'pool' or 'env'
- `shape(type, size)` - Define spell shape: ball, cone, beam, nova, wall
- `attribute(type)` - Add element: fire, light, ice, shadow, arcane, void
- `speed(units)` - Set projectile speed (affects mana drain)
- `follow(target)` - Make spell track targets
- `reserve(amount)` - Lock mana for special effects
- `explode()` - Release reserved mana as AoE damage
- `cast(scrollName)` - Cast another scroll as sub-spell

#### Hooks
- `on_hit(() => {...})` - Triggered when spell hits target
- `on_deplete(() => {...})` - Triggered when mana runs out
- `on_check({every: N}, () => {...})` - Periodic check every N seconds
- `on_low_mana({threshold: N}, () => {...})` - Triggered when mana drops below threshold

#### Example Spells

**Fireball**
```javascript
gather(pool, 50)
shape("ball")
attribute("fire")
speed(8)
on_hit(() => {
    // Deal fire damage
})
```

**Seeking Ice Nova**
```javascript
gather(env, 150)
shape("nova", 3)
attribute("ice")
follow(enemy)
speed(6)
```

**Explosive Arcane Beam**
```javascript
gather(pool, 200)
shape("beam")
attribute("arcane")
speed(10)
reserve(50)
on_hit(() => {
    explode()
})
```

### 🔬 Spell Lab
Access the Spell Lab from the main menu by pressing `L`. The lab is a sandbox environment where you can:
- **Test Spells**: Experiment with new spell designs without wasting mana
- **Infinite Mana**: Cast spells freely without resource constraints
- **Training Dummy**: Target a stationary dummy to test damage and effects
- **Visual Configuration**: Use interactive buttons to configure spell properties:
  - **Shape Buttons**: Select from ball, cone, beam, nova, or wall
  - **Attribute Buttons**: Choose fire, ice, light, shadow, arcane, or void
  - **Speed Slider**: Adjust projectile speed (1-10)
  - **Size Slider**: Modify spell size (1-5)
  - **Follow Toggle**: Enable/disable target tracking
- **Live Stats**: View real-time spell statistics including shape, attributes, speed, mana drain, and more
- **Spell Naming**: Name your custom spells for easy identification
- **Save System**: Save up to 3 spell configurations that persist between sessions
- **Quick Iteration**: Configure your spell and immediately test changes by clicking the canvas

**Lab Controls:**
- Press `L` from the main menu to enter the Spell Lab
- Press `M` to return to the main menu
- Click shape/attribute buttons to select spell components
- Drag sliders to adjust speed and size
- Click the Follow toggle to enable/disable tracking
- Click anywhere on the canvas (right side) to cast your spell at that location
- Your configured spells are automatically saved to localStorage

### ⏸️ Pause Menu
During gameplay, press `ESC` or `P` to pause the game:
- **Resume**: Click the Resume button or press `ESC`/`P` to continue
- **Quit to Menu**: Click Quit to Menu to return to the main menu (progress will be lost)

### Gameplay Tips
- **Mana Management**: Balance upfront costs with ongoing drain
- **Spell Synergy**: Combine attributes and shapes for powerful effects
- **Sub-spells**: Use `cast()` to chain spells together
- **Environment Mana**: Slower to gather but doesn't deplete your pool
- **Size Matters**: Larger spells cost more but have greater impact
- **Practice in the Lab**: Use the Spell Lab to perfect your spells before battle
- **Save Your Best Spells**: Create and save powerful spell combinations in the lab

## 🏆 Scoring & Saves
- Survive waves to increase your score
- Each wave brings tougher enemies
- **High Score**: Your best score is automatically saved and displayed on the main menu
- **Saved Spells**: Custom spells created in the Spell Lab are persisted between sessions using localStorage
- Your final score is displayed when defeated

## 💀 Death & Restart
When your HP reaches zero:
- You'll see the "YOU LOST" screen with your stats (wave reached, final score)
- If you beat your high score, a "NEW HIGH SCORE!" message will appear
- Click anywhere or press `Enter`/`Space` to return to the main menu
- Start a new run and try to beat your previous score!

## 🔧 Technical Details
- Built with vanilla JavaScript and HTML5 Canvas
- No external dependencies
- Custom spell scripting engine with mana economy system
- Real-time spell lifecycle management
- LocalStorage integration for saving high scores and spell configurations

## 📜 License
Free to use and modify for educational and personal projects.

---

**Craft your spells. Survive the waves. Master the arcane.**

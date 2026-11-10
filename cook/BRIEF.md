# Brief: ThreeJSWorld Photorealistic Botanical Lake Garden

Target: Achieve a true photorealistic 3D botanical lake garden with physically flowing reflective water, cascading two-tier limestone fountain with splash foam, irregular slate stepping-stone path, sharply stratified karst rockery with moss and ferns, lush multi-layer wind-swaying turf, and realistic oak/pine/birch trees in golden-hour atmospheric light.
Stack: Pure TypeScript geometry & procedural PBR core (`runtime/core/*`) + Three.js v0.187 WebGL2 (`Sky`, `Water`, `PMREMGenerator`, custom GLSL water/foliage/stream shaders, `EffectComposer` + `UnrealBloomPass` + `OutputPass`) + Chromium WebGL2 headless Cook harness (`tools/cook_audit.mjs`).
References: `cook/refs/R01_hero.png`, `cook/refs/R02_fountain_water.png`, `cook/refs/R03_rockery_path.png`, `cook/refs/R04_aerial_meadow.png` (matching photorealistic mood, lighting, water motion, material depth, and zero-overlap spatial realism).
Bar: composition 95+, light 95+, color 95+, materials 95+, detail near & far 95+, water motion & realism 95+.
Calibration offset: -30 (applied from user critique of Round 0 `image-2.png`: previous build looked flat/non-photorealistic with frozen grey water).
Rules:
- Zero external models, HDRIs, or texture files — 100% procedural geometry, procedural textures, and code-authored GLSL shaders.
- Water MUST visibly flow, ripple concentrically from the fountain, reflect surrounding trees/sky/fountain via planar mirror reflection, reveal sunlit pebbles in shallow shore areas, and display aerated foam at stream splash zones.
- Strict zero-interference (`verifyGardenNonInterference`): zero solid object overlap across fountain, flagstones, rockery, trees, ferns, flowers, and grass.
- Keep `examples/botanical_inspector.html` clean and unobstructed on load, runnable on `0.0.0.0:4173` at the end of every round.
Started: 2026-11-10T00:00:00Z
User's words: "显然没有实现照片级风格3d场景，很糟糕  水本身没有流动fk 使用 cook 审查 实现真实场景构建 https://github.com/Leonxlnx/cook/tree/main"

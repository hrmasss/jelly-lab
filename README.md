# Jelly Lab

A soft body sandbox in the browser. Drop gummy bears, puddings, jelly cubes and friends on a plate, then squish them, throw them and pile them up.

Runs on desktop and phone. On a phone, "Tilt with phone" slides everything around the plate.

## Play

```sh
npm install
npm run dev
```

| Input | Does |
|---|---|
| Drag a jelly | Grab and squish it. Let go mid-drag to throw it. |
| Drag empty space | Look around. Scroll or pinch to zoom. |
| `1`–`7` | Drop a shape |
| `N` | Nudge everything |
| `C` | Clear the plate |
| `S` / `M` / `Space` | Quarter speed / show lattice / pause |

## How it works

```
shape formula (SDF)
  ├─> regular grid of cells covering the shape ─> 5 tetrahedra per cell ─> XPBD solver (web worker)
  └─> surface nets ─> smooth skin, each vertex tied to the tetrahedron that holds it ─> three.js
```

| Part | File | What it does |
|---|---|---|
| Shapes | `src/engine/shapes.ts` | Each jelly is a signed distance function plus palettes. Adding a shape is one entry. |
| Lattice | `src/engine/lattice.ts` | Builds the tetrahedral lattice, the skin, and each node's offset to the true surface. Cached per shape. |
| Body | `src/engine/body.ts` | XPBD edge and volume constraints, floor and fence, damping that only resists stretching, rigid-frame fit. |
| World | `src/engine/world.ts` | Substep loop, grabbing, jelly-on-jelly contact. |
| Worker | `src/sim.worker.ts` | Runs the world off the main thread. The page sends commands and gets node positions back each frame. |
| Render | `src/render/` | Skinning, normals, glassy physical material, plate, lights. |

Contact between jellies uses the other jelly's shape formula, carried into its current pose through the tetrahedron that contains the point. Jellies touch at their visible surfaces instead of their coarse lattices.

## Checks

```sh
npm run smoke   # headless physics: every shape drops and settles, a cube stays stacked on a cube, a six-jelly pile holds
npm run build
```

## Deploy

Every push to `main` builds and publishes to GitHub Pages through `.github/workflows/pages.yml`.

## License

MIT

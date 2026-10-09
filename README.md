# Eddie's Couch

**A toddler. A man. Nine couches.**

Play it: https://colbymk97.github.io/eddies-couch/

Theo (age 2) has eaten a whole bag of trash buns and has a dream: hurl on every seat of
every couch in Eddie's house. Eddie (age 35, owns nine couches and 400 hotdog buns, zero
hotdogs) is napping. He will not be napping for long.

## How to play

- Hurl on every seat of all 9 couches. Hold to charge a **MEGA HURL** that soaks several seats at once.
- Eat hotdog buns (or dig through trash cans) to refill your tummy.
- Eddie scrubs half-puked couches clean. Finish a couch and it's ruined forever.
- Missed shots leave puddles. Eddie slips on puddles.
- Hide under the dining table or the bed, throw squeaky toys to lure Eddie away, drink juice for the zoomies,
  and keep an eye on the microwave.
- Get caught three times and it's nap time.

**Keyboard + mouse:** WASD to waddle, mouse to look, click/Space to hurl (hold for mega), Shift to sprint,
Q or right-click to throw a toy, wheel to zoom, M to mute, Esc to pause.

**Touch:** left thumb to waddle, right thumb to look, HURL and TOY buttons. Play in landscape.

## Development

```sh
npm install
npm run dev     # local dev server
npm run build   # typecheck + production build into dist/
```

Built with Three.js, TypeScript and Vite. Everything (models, textures, sound effects and music) is
generated procedurally in code; there are no asset files. Pushing to `main` deploys to GitHub Pages.

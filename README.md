# Eddie's Couch

**Three people. One big house. Nine couches.**

Play it: https://colbymk97.github.io/eddies-couch/

Eddie has a big house, nine couches and very strong feelings about all of them. His guests do not
share those feelings. Pick a side:

- **Theo** (age 4, rainbow glasses, weak stomach) hurls. He's small enough to hide under the dining
  table and the bed.
- **Zach** (short, very buff, never without a drumstick) eats meat, flings saucy nuggets and leaves
  crumbs everywhere. He can flex out of Eddie's grip once per life. Everything he eats fills his gut,
  and a full gut is his power-up: he turns around and lets it rip. Then he has to make it to a bidet.
  Every toilet in the house has one.
- **Eddie** (round gold glasses, gingham, spray bottle) has to keep the house clean until bedtime.

Whoever you don't pick is played by the computer.

## How to play

**Theo or Zach**

- Mess up every seat of all 9 couches. Hold to charge a **MEGA** shot that soaks several seats at once.
- Eat nuggets, drumsticks and mac & cheese to refill. Eddie's fridge has a whole rotisserie chicken.
- Eddie scrubs half-messed couches clean. Finish a couch and it's ruined forever.
- Missed shots leave puddles. Eddie slips on puddles.
- Zach: tap to fling nuggets. When his gut meter is full, hold to aim the power-up (he backs up to the
  couch), then get to a bidet before the timer runs out or it's a code brown. He's slow and can't attack
  on the way, so Eddie can still grab him.
- Throw squeaky toys to lure Eddie away, drink juice for the zoomies, and keep an eye on the microwave.
- Get caught three times and it's time-out for good.

**Eddie**

- Survive until bedtime (2½ minutes) without losing 5 couches.
- Grab Theo or Zach to send them to the time-out corner. Lunge to close the gap.
- Hold the action button next to a stain to scrub it, or next to a puddle to mop it. A fully stained couch
  takes 10 seconds to soak through, so scrub one seat to save it.
- YELL freezes everyone nearby for a moment.

**Keyboard + mouse:** WASD to move, mouse to look, click/Space for the main action (hold for mega or to scrub),
Shift to sprint, Q or right-click to throw a toy (or yell), wheel to zoom, 1/2/3 to pick a character on the
title screen, M to mute, Esc to pause.

**Touch:** left thumb to move (you aim where you face), right thumb to look, big button for the main action,
small button for toy/yell. Play in landscape; on iPhone, Add to Home Screen for full screen.

## Development

```sh
npm install
npm run dev     # local dev server
npm run build   # typecheck + production build into dist/
```

Built with Three.js, TypeScript and Vite. Everything (models, textures, sound effects and music) is
generated procedurally in code; there are no asset files. Pushing to `main` deploys to GitHub Pages.

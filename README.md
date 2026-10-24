# HEXDRONES website

The coming-soon website for HEXDRONES by Gameclaw Studio.

## Edit and preview

Edit `dist/index.html` and `dist/styles.css`. The interactive scene uses the
project-created worker model in `dist/assets/world-models.js`; its Blender source
stays in the separate game repository.

```sh
npm ci
npm test
npm run build
python3 -m http.server 4173 --directory dist
```

Open http://localhost:4173. The website requires WebGL 2 for its interactive scene
and provides a readable fallback when it is unavailable. Keyboard users can focus
the terrain and use arrow keys to direct the swarm and Space to pause it. Pointer
and touch destinations, Pause, Reset, and reduced-motion preferences are supported.

`src/world.js` renders the scene. `dist/swarm.js` implements navigation, crowd
avoidance, spawning and movement-driven feet. The tests cover routing, clearance,
formation settling, spawning, and gait. Run the build after editing renderer code.

## Publishing

GitHub Actions runs tests, rebuilds the scene, and deploys only `dist/` to GitHub
Pages on every push to `main`. The workflow can also be started manually. Website
source and game source have separate repositories.

The intended custom domain is **hexdrones.ai**. Domain registration, DNS and the
custom domain setting must be completed before it can serve this site. The Pages
workflow does not change DNS or purchase domains.

## Rights and notices

Website code and HEXDRONES assets are proprietary Gameclaw project content; no
general redistribution licence is granted. Third-party font and software licences
are retained in `dist/assets/` and listed in `LICENSES.md`.

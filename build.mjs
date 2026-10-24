import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
await build({entryPoints:['src/world.js'],outfile:'dist/scene.js',bundle:true,format:'iife',target:['safari16','chrome110','firefox110'],minify:true,legalComments:'eof'});
// Upstream GLSL template strings contain trailing whitespace; keep generated diffs clean.
const outputPath='dist/scene.js';
await writeFile(outputPath,(await readFile(outputPath,'utf8')).replace(/[\t ]+$/gm,''));

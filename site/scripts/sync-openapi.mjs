// Reads the server's generated Swagger spec and prepares it for starlight-openapi.
// Usage: npm run sync-api [-- <path or URL>]
import { writeFile, readFile } from 'node:fs/promises';

const source = process.argv[2] ?? new URL('../../server/src/docs/swagger.json', import.meta.url).pathname;
const target = new URL('../openapi/antimony.swagger.json', import.meta.url);

const raw = source.startsWith('http')
	? await (await fetch(source)).text()
	: await readFile(source, 'utf8');
const spec = JSON.parse(raw);

// The generated spec has no host. The interface reaches the server through the
// reverse proxy under /api, so document it that way.
spec.host ??= 'antimony.example.com';
spec.basePath = '/api';
spec.schemes ??= ['https'];

await writeFile(target, JSON.stringify(spec, null, '\t') + '\n');
console.log(`Wrote ${Object.keys(spec.paths).length} paths from ${source}`);

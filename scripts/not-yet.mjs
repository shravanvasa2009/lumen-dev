// npm scripts whose checks don't exist yet point here, so calling one fails loudly instead of passing.
const name = process.argv[2] ?? 'this script';
console.error(`${name}: not implemented yet. The track that owns it replaces this entry in package.json.`);
process.exit(1);

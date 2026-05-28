const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '..', 'viewer', 'data', 'dev-mints.json');
fs.mkdirSync(path.dirname(filePath), { recursive: true });
fs.writeFileSync(filePath, JSON.stringify({ nextCubeId: 1, mints: [] }, null, 2) + '\n');
console.log(`reset ${filePath}`);

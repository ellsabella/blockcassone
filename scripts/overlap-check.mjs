// Which July-proven sample ids overlap today's pools, per collection? Runner files
// MUST have changed after the DNA fix; others must be byte-identical.
import fs from 'node:fs';
const JULY = { runner: [1, 55, 200, 777, 1500, 3000, 5000, 9000], skull: [1, 337, 500, 1000, 1337, 3000, 5000, 7000], noun: [1, 42, 100, 250], pepe: [1, 7, 33, 111], kevin: [1, 42, 100, 500] };
for (const [key, ids] of Object.entries(JULY)) {
  const pool = new Set(JSON.parse(fs.readFileSync(`data/cc0/pool-${key}.json`, 'utf8')).tokenIds);
  const overlap = ids.filter(id => pool.has(id));
  console.log(`${key}: july∩pool = [${overlap.join(',')}]`);
}

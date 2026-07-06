const fs = require('fs');
const path = require('path');

const query = process.argv[2];
const fileArg = process.argv[3] || 'userController.js';

if (!query) {
  console.log("Usage: node search.js <search_term> [file_name]");
  process.exit(0);
}

const fileToSearch = path.resolve(__dirname, fileArg);
if (!fs.existsSync(fileToSearch)) {
  console.error(`File not found: ${fileToSearch}`);
  process.exit(1);
}

const content = fs.readFileSync(fileToSearch, 'utf8');
const lines = content.split('\n');

console.log(`Searching for "${query}" in ${fileToSearch}:`);
let count = 0;
lines.forEach((line, idx) => {
  if (line.toLowerCase().includes(query.toLowerCase())) {
    console.log(`${idx + 1}: ${line.trim()}`);
    count++;
  }
});
console.log(`Found ${count} matches.`);

const fs = require('fs');
const path = require('path');

const query = process.argv[2];
if (!query) {
  console.log("Usage: node search.js <search_term>");
  process.exit(0);
}

const fileToSearch = path.join(__dirname, 'userController.js');
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

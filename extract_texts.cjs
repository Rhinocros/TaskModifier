const fs = require('fs');
const html = fs.readFileSync('src/index.html', 'utf-8');
const js = fs.readFileSync('src/main.js', 'utf-8');

const textNodes = new Set();

// Extract texts from HTML
const regex = />([^<]+)</g;
let match;
while ((match = regex.exec(html)) !== null) {
  let text = match[1].trim();
  // We want to capture text that contains Chinese characters
  if (text && /[\u4e00-\u9fa5]/.test(text)) {
    textNodes.add(text);
  }
}

// Extract texts from JS (e.g. strings containing Chinese)
const jsRegex = /(['"`])(.*?[\u4e00-\u9fa5]+.*?)\1/g;
while ((match = jsRegex.exec(js)) !== null) {
  textNodes.add(match[2]);
}

// Write to JSON
const result = {};
for (const txt of textNodes) {
    result[txt] = txt; // placeholder for translation
}

fs.writeFileSync('src/texts.json', JSON.stringify(result, null, 2));
console.log('Extracted ' + textNodes.size + ' texts.');

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

function dataPath(file) {
  return path.join(dataDir, file);
}

function loadJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(dataPath(file), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

function saveJSON(file, data) {
  fs.writeFileSync(dataPath(file), JSON.stringify(data, null, 2));
}

module.exports = { dataDir, dataPath, loadJSON, saveJSON };

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  command: 'mlx_whisper --model mlx-community/whisper-small-mlx --output-format txt --verbose True [INPUT_FILE]',
  maxParallelRuns: 3,
  watchFolders: false,
  model: 'small',
};

let configPath = null;

function init(appDataPath) {
  configPath = path.join(appDataPath, 'config.json');
}

function load() {
  if (!configPath) return { ...DEFAULTS };
  try {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return { ...DEFAULTS, ...data };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(settings) {
  if (!configPath) throw new Error('Config not initialized');
  const current = load();
  const merged = { ...current, ...settings };
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

module.exports = { init, load, save, DEFAULTS };

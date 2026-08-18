const fs = require('fs');
const path = require('path');

// Selectable transcription models, in dropdown order. Single source of truth:
// the renderer builds the model picker from this via the `get-models` IPC.
const MODELS = {
  small: {
    id: 'mlx-community/whisper-small-mlx',
    label: 'Small',
    accuracy: 'Good',
    speed: 'Fastest',
    size: '480 MB',
    ram: '2 GB',
  },
  turbo: {
    id: 'mlx-community/whisper-large-v3-turbo',
    label: 'Turbo (Recommended)',
    accuracy: 'Excellent',
    speed: 'Fast',
    size: '1.6 GB',
    ram: '4 GB',
  },
  large: {
    id: 'mlx-community/whisper-large-v3-mlx',
    label: 'Large',
    accuracy: 'Best',
    speed: 'Slower',
    size: '3.1 GB',
    ram: '6 GB',
  },
};

// Models that used to be selectable, mapped to their closest replacement.
const LEGACY_MODELS = {
  tiny: 'small',
  medium: 'turbo',
};

const DEFAULTS = {
  command: `mlx_whisper --model ${MODELS.turbo.id} --output-format txt --verbose True [INPUT_FILE]`,
  maxParallelRuns: 3,
  watchFolders: false,
  model: 'turbo',
};

let configPath = null;

function init(appDataPath) {
  configPath = path.join(appDataPath, 'config.json');
}

// Point configs saved before a model was retired at its replacement. Only the
// --model argument is rewritten, so any other customization of the command survives.
function migrateModel(cfg) {
  const replacement = LEGACY_MODELS[cfg.model];
  if (!replacement) return cfg;
  return {
    ...cfg,
    model: replacement,
    command: cfg.command.replace(/--model\s+\S+/, `--model ${MODELS[replacement].id}`),
  };
}

function load() {
  if (!configPath) return { ...DEFAULTS };
  try {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return migrateModel({ ...DEFAULTS, ...data });
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

module.exports = { init, load, save, DEFAULTS, MODELS };

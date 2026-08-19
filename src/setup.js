const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

function getAppDataPath() {
  return process.env.TRANSCRIBER_DATA_DIR ||
    path.join(process.env.HOME || process.env.USERPROFILE, '.transcriber');
}

function getVenvPath() { return path.join(getAppDataPath(), 'venv'); }
function getVenvBinPath() { return path.join(getVenvPath(), 'bin'); }
function getMlxWhisperBin() { return path.join(getVenvBinPath(), 'mlx_whisper'); }
function getPipBin() { return path.join(getVenvBinPath(), 'pip'); }

function isSetupComplete() {
  return fs.existsSync(getMlxWhisperBin());
}

function getEnvWithPaths() {
  const env = { ...process.env, PYTHONUNBUFFERED: '1' };
  env.PATH = ['/opt/homebrew/bin', '/usr/local/bin'].join(':') + ':' + (env.PATH || '');
  return env;
}

function checkPython() {
  return new Promise((resolve) => {
    const proc = spawn('python3', ['--version'], { env: getEnvWithPaths() });
    let output = '';
    proc.stdout.on('data', (data) => { output += data.toString(); });
    proc.stderr.on('data', (data) => { output += data.toString(); });
    proc.on('close', (code) => {
      resolve(code === 0 ? output.trim() : null);
    });
    proc.on('error', () => resolve(null));
  });
}

function commandExists(cmd) {
  return new Promise((resolve) => {
    const proc = spawn('which', [cmd], { env: getEnvWithPaths() });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

function runCommand(cmd, args, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { env: getEnvWithPaths() });

    let stderr = '';

    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      for (const line of lines) {
        onProgress?.(line.trim());
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      const lines = data.toString().split('\n').filter(l => l.trim());
      for (const line of lines) {
        if (line.includes('Installing') || line.includes('Collecting') ||
            line.includes('Downloading') || line.includes('Successfully') ||
            line.includes('Building') || line.includes('Using')) {
          onProgress?.(line.trim());
        }
      }
    });

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `Command failed with code ${code}`));
    });

    proc.on('error', reject);
  });
}

function checkPlatform() {
  if (process.platform !== 'darwin') {
    return 'Transcriber requires macOS.';
  }
  if (process.arch !== 'arm64') {
    return 'Transcriber requires Apple Silicon (M1 or later). Intel Macs are not supported.';
  }
  // Darwin 23.x = macOS 14 Sonoma (minimum for MLX)
  const darwinMajor = parseInt(os.release().split('.')[0], 10);
  if (darwinMajor < 23) {
    return 'Transcriber requires macOS 14 (Sonoma) or later. Please update your Mac.';
  }
  return null;
}

async function runSetup(onProgress, modelName) {
  onProgress?.('Checking system requirements...');
  const platformError = checkPlatform();
  if (platformError) {
    throw new Error(platformError);
  }

  onProgress?.('Checking for Python 3...');
  const pythonVersion = await checkPython();
  if (!pythonVersion) {
    throw new Error(
      'Python 3 not found.\n\n' +
      'macOS may have shown a dialog to install Command Line Tools.\n' +
      'If so, click "Install", wait for it to finish, then reopen Transcriber.\n\n' +
      'Or install manually in Terminal:\n' +
      'xcode-select --install'
    );
  }
  onProgress?.(pythonVersion);

  onProgress?.('Creating Python environment...');
  await runCommand('python3', ['-m', 'venv', getVenvPath()], onProgress);

  onProgress?.('Installing MLX Whisper (this may take a few minutes)...');
  await runCommand(getPipBin(), ['install', 'mlx-whisper'], onProgress);

  if (!isSetupComplete()) {
    throw new Error('Installation completed but mlx_whisper binary not found.');
  }

  const hasFFmpeg = await commandExists('ffmpeg');
  if (!hasFFmpeg) {
    onProgress?.('Installing ffmpeg...');
    try {
      await runCommand(getPipBin(), ['install', 'static-ffmpeg'], onProgress);
      const pythonBin = path.join(getVenvBinPath(), 'python3');
      await runCommand(pythonBin, ['-c', [
        'import static_ffmpeg, os, sys',
        'ffmpeg, probe = static_ffmpeg.run.get_or_fetch_platform_executables_else_raise()',
        'b = os.path.dirname(sys.executable)',
        'for s in (ffmpeg, probe):',
        '  d = os.path.join(b, os.path.basename(s))',
        '  os.path.exists(d) or os.symlink(s, d)',
      ].join('\n')], onProgress);
      onProgress?.('ffmpeg installed.');
    } catch {
      throw new Error(
        'Could not install ffmpeg automatically.\n\n' +
        'Please install it manually:\n' +
        '1. Install Homebrew: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"\n' +
        '2. Run: brew install ffmpeg\n' +
        '3. Reopen Transcriber.'
      );
    }
  }

  if (modelName) {
    onProgress?.(`Downloading language model (${modelName})... This may take a few minutes.`);
    const pythonBin = path.join(getVenvBinPath(), 'python3');
    await runCommand(pythonBin, ['-c',
      `from huggingface_hub import snapshot_download; snapshot_download("${modelName}")`
    ], onProgress);
    onProgress?.('Language model downloaded.');
  }

  onProgress?.('Setup complete!');
}

function isModelDownloaded(modelId) {
  const cacheDir = path.join(os.homedir(), '.cache', 'huggingface', 'hub',
    'models--' + modelId.replace('/', '--'), 'snapshots');
  try {
    const entries = fs.readdirSync(cacheDir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

const HUB_TIMEOUT_MS = 5000;

// Asks the Hugging Face API whether a model repo exists. Hugging Face answers
// 401 rather than 404 for a repo that is not there (so it cannot be used to
// probe for private repos), which is why a mistyped model id reaches the user as
// "Invalid username or password". Anything other than a definitive answer is
// 'unknown', so a user without network access is never blocked from saving.
async function modelExistsOnHub(modelId) {
  try {
    const response = await fetch(`https://huggingface.co/api/models/${modelId}`, {
      signal: AbortSignal.timeout(HUB_TIMEOUT_MS),
    });
    if (response.status === 200) return 'exists';
    if (response.status === 401 || response.status === 404) return 'missing';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

async function downloadModel(modelId, onProgress) {
  onProgress?.(`Downloading model ${modelId}...`);
  const pythonBin = path.join(getVenvBinPath(), 'python3');
  await runCommand(pythonBin, ['-c',
    `from huggingface_hub import snapshot_download; snapshot_download("${modelId}")`
  ], onProgress);
  onProgress?.('Model downloaded.');
}

module.exports = { getAppDataPath, getVenvBinPath, isSetupComplete, runSetup, isModelDownloaded, modelExistsOnHub, downloadModel };

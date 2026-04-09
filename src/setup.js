const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const appDataPath = path.join(process.env.HOME || process.env.USERPROFILE, '.transcriber');
const venvPath = path.join(appDataPath, 'venv');
const venvBin = path.join(venvPath, 'bin');
const mlxWhisperBin = path.join(venvBin, 'mlx_whisper');
const pipBin = path.join(venvBin, 'pip');

function getVenvBinPath() {
  return venvBin;
}

function isSetupComplete() {
  return fs.existsSync(mlxWhisperBin);
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

async function runSetup(onProgress) {
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
  await runCommand('python3', ['-m', 'venv', venvPath], onProgress);

  onProgress?.('Installing MLX Whisper (this may take a few minutes)...');
  await runCommand(pipBin, ['install', 'mlx-whisper'], onProgress);

  if (!isSetupComplete()) {
    throw new Error('Installation completed but mlx_whisper binary not found.');
  }

  const hasFFmpeg = await commandExists('ffmpeg');
  if (!hasFFmpeg) {
    onProgress?.('Installing ffmpeg...');
    try {
      await runCommand(pipBin, ['install', 'static-ffmpeg'], onProgress);
      const pythonBin = path.join(venvBin, 'python3');
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

  onProgress?.('Setup complete! First transcription will download the language model (~1.5 GB).');
}

module.exports = { getVenvBinPath, isSetupComplete, runSetup };

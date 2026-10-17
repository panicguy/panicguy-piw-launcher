const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function ensureElectron() {
  const rootDir = path.resolve(__dirname, '..');
  const electronDir = path.join(rootDir, 'node_modules', 'electron');
  const electronExe = path.join(electronDir, 'dist', 'electron.exe');

  if (fs.existsSync(electronExe)) {
    return true;
  }

  console.log('[PIO] Inicializando instalacao do Electron...');

  // 1. Tentar primeiro o instalador padrao do Electron (se existir apos npm install)
  const installJs = path.join(electronDir, 'install.js');
  if (fs.existsSync(installJs)) {
    try {
      execSync(`"${process.execPath}" "${installJs}"`, { stdio: 'inherit' });
      if (fs.existsSync(electronExe)) {
        return true;
      }
    } catch (_) {
      console.warn('[PIO] Extrator padrao falhou. Tentando instalacao de contingencia direta...');
    }
  }

  // 2. Contingencia: Baixar e extrair nativamente via Windows (tar.exe ou PowerShell)
  console.log('[PIO] Executando instalacao de contingencia sem dependencias externas...');
  try {
    let version = '43.1.1';
    try {
      const pkg = require(path.join(electronDir, 'package.json'));
      if (pkg.version) version = pkg.version;
    } catch (_) {
      try {
        const rootPkg = require(path.join(rootDir, 'package.json'));
        if (rootPkg.devDependencies && rootPkg.devDependencies.electron) {
          version = rootPkg.devDependencies.electron.replace(/^[\^~]/, '');
        }
      } catch (_) {}
    }

    let zipPath = null;
    try {
      const { downloadArtifact } = require('@electron/get');
      zipPath = await downloadArtifact({
        version,
        artifactName: 'electron',
        platform: 'win32',
        arch: 'x64'
      });
    } catch (_) {
      // Se @electron/get nao estiver presente (ex.: npm falhou), baixa diretamente do GitHub oficial
      const cacheDir = path.join(rootDir, '.runtime');
      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
      zipPath = path.join(cacheDir, `electron-v${version}-win32-x64.zip`);
      if (!fs.existsSync(zipPath)) {
        const electronZipUrl = `https://github.com/electron/electron/releases/download/v${version}/electron-v${version}-win32-x64.zip`;
        console.log(`[PIO] Baixando Electron v${version} diretamente do GitHub oficial...`);
        let downloaded = false;
        try {
          execSync(`curl.exe -L "${electronZipUrl}" -o "${zipPath}"`, { stdio: 'inherit' });
          if (fs.existsSync(zipPath) && fs.statSync(zipPath).size > 1000000) downloaded = true;
        } catch (_) {}
        if (!downloaded) {
          const psCmd = `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object Net.WebClient).DownloadFile('${electronZipUrl}', '${zipPath.replace(/'/g, "''")}')`;
          execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psCmd}"`, { stdio: 'inherit' });
        }
      }
    }

    const distPath = path.join(electronDir, 'dist');
    if (!fs.existsSync(distPath)) {
      fs.mkdirSync(distPath, { recursive: true });
    }

    let extracted = false;
    try {
      console.log('[PIO] Extraindo arquivos do Electron via tar do Windows...');
      execSync(`tar.exe -xf "${zipPath}" -C "${distPath}"`, { stdio: 'inherit' });
      if (fs.existsSync(electronExe)) {
        extracted = true;
      }
    } catch (_) {}

    if (!extracted) {
      console.log('[PIO] Extraindo arquivos via PowerShell Expand-Archive...');
      const psCmd = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${distPath.replace(/'/g, "''")}' -Force`;
      execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psCmd}"`, { stdio: 'inherit' });
    }

    // Mover electron.d.ts se necessario
    const srcDts = path.join(distPath, 'electron.d.ts');
    const targetDts = path.join(electronDir, 'electron.d.ts');
    if (fs.existsSync(srcDts)) {
      try {
        fs.renameSync(srcDts, targetDts);
      } catch (_) {}
    }

    // Gravar path.txt
    fs.writeFileSync(path.join(electronDir, 'path.txt'), 'electron.exe', 'utf-8');

    if (fs.existsSync(electronExe)) {
      console.log('[PIO] Electron configurado com sucesso via contingencia!');
      return true;
    }
  } catch (err) {
    console.error('[PIO] Erro na instalacao de contingencia:', err && err.message ? err.message : err);
  }

  return false;
}

ensureElectron().then(ok => {
  process.exit(ok ? 0 : 1);
});

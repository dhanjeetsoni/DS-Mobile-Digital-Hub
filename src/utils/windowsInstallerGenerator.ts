import { Database } from "../types";

/**
 * Generates and downloads a complete Windows Setup Batch & PowerShell Installer.
 * Creates Desktop Shortcut, Start Menu entry, and dedicated app runner.
 */
export function downloadWindowsSetupInstaller(db: Database) {
  const shopName = db.settings.shopName || "DS Mobile & Digital Hub Pro";
  const cleanTitle = shopName.replace(/[^\w\s-]/gi, "");
  const currentUrl = window.location.href;

  const installerBat = `@echo off
:: ============================================================================
:: ${cleanTitle} - Windows Desktop Installer & Setup Wizard
:: ============================================================================
COLOR 0B
cls
echo.
echo ============================================================================
echo      ${cleanTitle} - Windows Desktop Installation Setup
echo ============================================================================
echo.
echo [1/4] Initializing installation environment...
set "INSTALL_DIR=%LOCALAPPDATA%\\Programs\\DSMobilePro"
set "SHORTCUT_NAME=${cleanTitle}.lnk"
set "DESKTOP_DIR=%USERPROFILE%\\Desktop"
set "STARTMENU_DIR=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\${cleanTitle}"

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
if not exist "%STARTMENU_DIR%" mkdir "%STARTMENU_DIR%"

echo [2/4] Creating Windows Desktop Launcher...
(
echo @echo off
echo title ${cleanTitle} Desktop
echo :: Check Microsoft Edge or Google Chrome standalone app mode
echo if exist "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe" ^(
echo     start "" "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe" --app="${currentUrl}" --window-size=1280,800
echo     exit
echo ^)
echo if exist "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe" ^(
echo     start "" "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe" --app="${currentUrl}" --window-size=1280,800
echo     exit
echo ^)
echo if exist "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" ^(
echo     start "" "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" --app="${currentUrl}" --window-size=1280,800
echo     exit
echo ^)
echo if exist "%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe" ^(
echo     start "" "%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe" --app="${currentUrl}" --window-size=1280,800
echo     exit
echo ^)
echo start "" "${currentUrl}"
echo exit
) > "%INSTALL_DIR%\\launch.bat"

echo [3/4] Creating Desktop & Start Menu Shortcuts (.lnk)...
powershell -Command "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%DESKTOP_DIR%\\%SHORTCUT_NAME%'); $Shortcut.TargetPath = '%INSTALL_DIR%\\launch.bat'; $Shortcut.WorkingDirectory = '%INSTALL_DIR%'; $Shortcut.Description = '${cleanTitle} Desktop Billing OS'; $Shortcut.Save()"
powershell -Command "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%STARTMENU_DIR%\\%SHORTCUT_NAME%'); $Shortcut.TargetPath = '%INSTALL_DIR%\\launch.bat'; $Shortcut.WorkingDirectory = '%INSTALL_DIR%'; $Shortcut.Description = '${cleanTitle} Desktop Billing OS'; $Shortcut.Save()"

echo [4/4] Creating Uninstaller script...
(
echo @echo off
echo title Uninstall ${cleanTitle}
echo echo Removing ${cleanTitle}...
echo del "%DESKTOP_DIR%\\%SHORTCUT_NAME%" 2>nul
echo rmdir /s /q "%STARTMENU_DIR%" 2>nul
echo rmdir /s /q "%INSTALL_DIR%" 2>nul
echo echo ${cleanTitle} has been successfully uninstalled from your Windows PC.
echo pause
) > "%INSTALL_DIR%\\uninstall.bat"

cls
echo.
echo ============================================================================
echo      SUCCESS! ${cleanTitle} HAS BEEN INSTALLED ON WINDOWS!
echo ============================================================================
echo.
echo  [+] Desktop Shortcut Created: "%DESKTOP_DIR%\\%SHORTCUT_NAME%"
echo  [+] Start Menu Entry Created: "%STARTMENU_DIR%"
echo  [+] Dedicated Window Launcher: "%INSTALL_DIR%\\launch.bat"
echo.
echo  Starting ${cleanTitle} now...
start "" "%INSTALL_DIR%\\launch.bat"
timeout /t 3 >nul
exit
`;

  const blob = new Blob([installerBat], { type: "application/x-bat" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `Install-${cleanTitle.replace(/\s+/g, "-")}-Setup.bat`;
  a.click();
}

/**
 * Generates and downloads a complete Electron Windows App source bundle.
 * Ready for `npm install && npm start` or `npm run dist` to produce a real .exe installer.
 */
export function downloadElectronWindowsSource(db: Database) {
  const shopName = db.settings.shopName || "DS Mobile & Digital Hub Pro";
  const cleanTitle = shopName.replace(/[^\w\s-]/gi, "");
  const currentUrl = window.location.href;

  const electronMainJs = `// Electron Main Process for ${cleanTitle}
const { app, BrowserWindow, Menu, globalShortcut, dialog } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 850,
    minWidth: 1024,
    minHeight: 700,
    title: "${cleanTitle}",
    autoHideMenuBar: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    },
    icon: path.join(__dirname, 'icon.png')
  });

  mainWindow.loadURL("${currentUrl}");

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Windows Fast Key Bindings
  globalShortcut.register('F2', () => {
    mainWindow.webContents.executeJavaScript("window.location.hash = '#/sell';");
  });
  globalShortcut.register('F9', () => {
    mainWindow.webContents.executeJavaScript("window.location.hash = '#/galla';");
  });
  globalShortcut.register('F11', () => {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
`;

  const packageJson = {
    name: "ds-mobile-desktop",
    version: "1.0.0",
    description: `${cleanTitle} - Windows Desktop POS & Management OS`,
    main: "main.js",
    scripts: {
      start: "electron .",
      dist: "electron-builder --win",
    },
    devDependencies: {
      electron: "^28.2.0",
      "electron-builder": "^24.9.1",
    },
    build: {
      appId: "com.dsmobile.billing",
      productName: cleanTitle,
      win: {
        target: ["nsis", "portable"],
        icon: "icon.png",
      },
      nsis: {
        oneClick: false,
        allowToChangeInstallationDirectory: true,
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
      },
    },
  };

  const buildBat = `@echo off
title Build Windows .EXE Installer for ${cleanTitle}
echo ================================================================
echo Building ${cleanTitle} Windows .EXE Installer (NSIS & Portable)
echo ================================================================
echo.
echo Step 1: Installing Electron dependencies...
call npm install
if errorlevel 1 goto :err

echo.
echo Step 2: Packaging into Windows .EXE...
call npm run dist
if errorlevel 1 goto :err

echo.
echo ================================================================
echo SUCCESS! Your Windows .exe installer is in the "dist" folder.
echo ================================================================
pause
exit

:err
echo [ERROR] Build failed. Please ensure Node.js is installed on your Windows PC.
pause
exit
`;

  const readmeTxt = `====================================================================
${cleanTitle.toUpperCase()} - WINDOWS ELECTRON APP BUILD GUIDE
====================================================================

HOW TO RUN & BUILD .EXE ON YOUR WINDOWS PC:
1. Make sure Node.js is installed (https://nodejs.org)
2. Extract all files to a folder (e.g. C:\\DS-Mobile-Desktop)
3. Open Command Prompt in that folder and run:
     npm install
     npm start

4. TO BUILD STANDALONE .EXE INSTALLER:
   Double click on "build-exe.bat" or run:
     npm run dist

   This will generate:
   - dist\\${cleanTitle} Setup 1.0.0.exe (Full Windows Installer)
   - dist\\${cleanTitle} 1.0.0.exe (Portable Windows App)
`;

  // Download files as a simple combined text bundle or individual files
  const combinedBundle = `=== FILE: main.js ===\n${electronMainJs}\n\n=== FILE: package.json ===\n${JSON.stringify(
    packageJson,
    null,
    2
  )}\n\n=== FILE: build-exe.bat ===\n${buildBat}\n\n=== FILE: README.txt ===\n${readmeTxt}`;

  const blob = new Blob([combinedBundle], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `DS-Mobile-Electron-Windows-Source.txt`;
  a.click();
}

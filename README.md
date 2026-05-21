# Burrata POS — Electron Kiosk

Electron wrapper that opens the Burrata POS web app in a fullscreen kiosk window.

## Setup

1. **Install dependencies**
   ```
   npm install
   ```

2. **Run in development**
   ```
   npm start
   ```

3. **Build Windows installer**
   ```
   npm run build:win
   ```
   The installer is output to `dist/`. It runs silently and installs for all users (`perMachine: true`).

## Admin Access

Press **Ctrl+Shift+Q** to quit the kiosk. This is the only exit available during normal operation.

## Icon

Before building, add a `assets/icon.ico` file (256×256 recommended). The `assets/` directory is already created — place the `.ico` file there manually. Without it, `electron-builder` will use a default Electron icon.

const { app, BrowserWindow, globalShortcut, ipcMain, dialog } = require("electron")
const path = require("path")

const POS_URL          = "https://burrata-pos.vercel.app/pos"
const PRINT_WORKER_URL = "https://burrata-pos.vercel.app/pos/print-worker"

let mainWin       = null
let printWorkerWin = null

function createWindows() {
  // ── Main kiosk window ────────────────────────────────────────────────────────
  mainWin = new BrowserWindow({
    fullscreen: true,
    kiosk: true,
    autoHideMenuBar: true,
    backgroundColor: "#09090b",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  mainWin.loadURL(POS_URL)
  mainWin.on("closed", () => { mainWin = null })

  // ── Hidden print worker window ───────────────────────────────────────────────
  // Runs /pos/print-worker in the background. Shares the same Chromium session
  // (cookies / localStorage) as the main window, so it becomes authenticated
  // automatically when the staff member logs in on the main screen.
  printWorkerWin = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  printWorkerWin.loadURL(PRINT_WORKER_URL)
  printWorkerWin.on("closed", () => { printWorkerWin = null })
}

// ── IPC: list installed Windows printers ─────────────────────────────────────
ipcMain.handle("get-printers", async () => {
  const win = mainWin || BrowserWindow.getAllWindows()[0]
  if (!win) return []
  const list = await win.webContents.getPrintersAsync()
  // Return only what the renderer needs
  return list.map(p => ({ name: p.name, isDefault: p.isDefault }))
})

// ── IPC: print HTML to a named Windows printer ───────────────────────────────
// Renders HTML in a hidden Chromium window and sends directly to the Windows
// print spooler via webContents.print() with silent:true — no PDF, no PowerShell.
ipcMain.handle("print-html", async (_event, printerName, html) => {
  const win = new BrowserWindow({
    show: false,
    width: 400,
    height: 800,
    paintWhenInitiallyHidden: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })

  try {
    const base64 = Buffer.from(html).toString("base64")
    await win.loadURL(`data:text/html;base64,${base64}`)
    await new Promise(r => setTimeout(r, 600)) // let Chromium finish layout

    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Print timed out — check the printer is online."))
      }, 30000)

      win.webContents.print(
        {
          silent: true,
          printBackground: true,
          deviceName: printerName,
          pageSize: { width: 80000, height: 297000 }, // 80 mm wide, microns
          margins: { marginType: "none" },
        },
        (success, errorType) => {
          clearTimeout(timeout)
          if (success) resolve(true)
          else reject(new Error(`Print failed: ${errorType ?? "unknown error"}`))
        }
      )
    })
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
})

app.whenReady().then(() => {
  createWindows()

  // Admin escape hatch — Ctrl+Shift+Q exits the kiosk
  globalShortcut.register("CommandOrControl+Shift+Q", () => app.quit())

  // Version check — Ctrl+Shift+V shows current version in a dialog
  globalShortcut.register("CommandOrControl+Shift+V", () => {
    dialog.showMessageBox({ title: "Burrata POS", message: `Version: ${app.getVersion()}\nElectron: ${process.versions.electron}` })
  })

  // DevTools — Ctrl+Shift+I opens browser console (admin debug only)
  globalShortcut.register("CommandOrControl+Shift+I", () => {
    if (mainWin) mainWin.webContents.openDevTools({ mode: "detach" })
  })

  app.on("activate", () => {
    if (!mainWin) createWindows()
  })
})

app.on("will-quit", () => globalShortcut.unregisterAll())

// On Windows a POS terminal always has exactly one instance
app.on("window-all-closed", () => app.quit())

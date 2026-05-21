const { app, BrowserWindow, globalShortcut, ipcMain } = require("electron")
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
// Creates an offscreen window, loads the HTML, prints silently, destroys window.
ipcMain.handle("print-html", async (_event, printerName, html) => {
  const win = new BrowserWindow({
    show: false,
    width: 400,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // Load HTML via data URI — Chromium handles it cleanly for typical receipt sizes
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html))

  return new Promise((resolve, reject) => {
    win.webContents.print(
      {
        deviceName: printerName,
        silent: true,
        printBackground: true,
        margins: { marginType: "none" },
      },
      (success, failureReason) => {
        win.destroy()
        if (success) resolve(true)
        else reject(new Error(failureReason || "Print failed"))
      }
    )
  })
})

app.whenReady().then(() => {
  createWindows()

  // Admin escape hatch — Ctrl+Shift+Q exits the kiosk
  globalShortcut.register("CommandOrControl+Shift+Q", () => app.quit())

  app.on("activate", () => {
    if (!mainWin) createWindows()
  })
})

app.on("will-quit", () => globalShortcut.unregisterAll())

// On Windows a POS terminal always has exactly one instance
app.on("window-all-closed", () => app.quit())

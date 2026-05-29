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
    // Required for Chromium to render content in a hidden window
    paintWhenInitiallyHidden: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  try {
    // Inject HTML directly — more reliable than data: URI for large receipts
    await win.loadURL("about:blank")
    await win.webContents.executeJavaScript(
      `document.open(); document.write(${JSON.stringify(html)}); document.close();`
    )

    // Give Chromium ~500ms to fully paint before sending to printer
    await new Promise(resolve => setTimeout(resolve, 500))

    return await new Promise((resolve, reject) => {
      // Safety timeout — printer callback can hang if device is offline/misconfigured
      const timeout = setTimeout(() => {
        if (!win.isDestroyed()) win.destroy()
        reject(new Error("Print timed out — check that the printer is online and the name is correct."))
      }, 15000)

      win.webContents.print(
        {
          deviceName: printerName,
          silent: true,
          printBackground: true,
          margins: { marginType: "none" },
        },
        (success, failureReason) => {
          clearTimeout(timeout)
          if (!win.isDestroyed()) win.destroy()
          if (success) resolve(true)
          else reject(new Error(failureReason || "Print failed — check printer name and status."))
        }
      )
    })
  } catch (err) {
    if (!win.isDestroyed()) win.destroy()
    throw err
  }
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

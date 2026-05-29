const { app, BrowserWindow, globalShortcut, ipcMain, dialog } = require("electron")
const { exec } = require("child_process")
const path = require("path")
const fs   = require("fs")
const os   = require("os")

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
// Step 1: Render HTML → PDF via Chromium (printToPDF never blocks/hangs).
// Step 2: Write PDF to temp file.
// Step 3: Print via PowerShell Start-Process PrintTo verb (uses Windows built-in
//         PDF association — Edge on Win10/11 — to send silently to named printer).
ipcMain.handle("print-html", async (_event, printerName, html) => {
  console.log(`[print-html] START — printer: "${printerName}"`)

  // ── Render to PDF ──────────────────────────────────────────────────────────
  const win = new BrowserWindow({
    show: false,
    width: 400,
    height: 800,
    paintWhenInitiallyHidden: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })

  let pdfBuffer
  try {
    const base64 = Buffer.from(html).toString("base64")
    console.log(`[print-html] Loading HTML (${html.length} chars)...`)
    await win.loadURL(`data:text/html;base64,${base64}`)
    await new Promise(r => setTimeout(r, 500))
    console.log(`[print-html] Generating PDF via printToPDF...`)
    pdfBuffer = await win.webContents.printToPDF({
      pageSize: { width: 80000, height: 297000 }, // 80mm wide, microns
      printBackground: true,
      margins: { marginType: "none" },
    })
    console.log(`[print-html] PDF generated: ${pdfBuffer.length} bytes`)
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }

  // ── Write temp PDF ─────────────────────────────────────────────────────────
  const tmpPdf = path.join(os.tmpdir(), `burrata-receipt-${Date.now()}.pdf`)
  fs.writeFileSync(tmpPdf, pdfBuffer)
  console.log(`[print-html] Temp PDF written: ${tmpPdf}`)

  // ── Print via PowerShell ───────────────────────────────────────────────────
  const esc = (s) => s.replace(/\\/g, "\\\\").replace(/'/g, "''")
  const psCmd = [
    `$pdf = '${esc(tmpPdf)}'`,
    `$prn = '${esc(printerName)}'`,
    `Start-Process -FilePath $pdf -Verb PrintTo -ArgumentList $prn -Wait`,
    `Start-Sleep -Seconds 3`,
  ].join("; ")

  console.log(`[print-html] Running PowerShell PrintTo...`)

  return new Promise((resolve, reject) => {
    const cleanup = () => { try { fs.unlinkSync(tmpPdf) } catch {} }
    const timeout = setTimeout(() => {
      cleanup()
      console.error(`[print-html] TIMEOUT after 30s`)
      reject(new Error("Print timed out — check the printer is online."))
    }, 30000)

    exec(
      `powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "${psCmd}"`,
      { timeout: 35000 },
      (error, stdout, stderr) => {
        clearTimeout(timeout)
        cleanup()
        if (error) {
          console.error(`[print-html] PowerShell ERROR: ${stderr || error.message}`)
          reject(new Error(`Print failed: ${stderr || error.message}`))
        } else {
          console.log(`[print-html] SUCCESS — stdout: ${stdout}`)
          resolve(true)
        }
      }
    )
  })
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

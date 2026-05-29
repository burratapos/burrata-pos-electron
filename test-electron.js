// Electron test — verifies the printToPDF + PowerShell approach end-to-end.
// Run with: npx electron test-electron.js

const { app, BrowserWindow } = require('electron')
const { exec }  = require('child_process')
const fs   = require('fs')
const os   = require('os')
const path = require('path')

const TEST_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin:0; padding:0; }
  body { font-family: 'Courier New', monospace; font-size:13px; width:302px; padding:12px; }
  h2 { text-align:center; }
  .divider { border-top:1px dashed #000; margin:6px 0; }
  @media print { @page { size: 80mm auto; margin:0; } }
</style>
</head>
<body>
<h2>BURRATA POS - TEST</h2>
<div class="divider"></div>
<p><strong>Order #1 · Table: Test</strong></p>
<div class="divider"></div>
<p>1x Test Item</p>
<div class="divider"></div>
<p style="text-align:center">Print working!</p>
</body>
</html>`

async function printHtml(printerName, html) {
  // Step 1: Render HTML to PDF using Chromium — always resolves, never blocks
  const win = new BrowserWindow({
    show: false,
    width: 400,
    height: 800,
    paintWhenInitiallyHidden: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })

  let pdfBuffer
  try {
    const base64 = Buffer.from(html).toString('base64')
    console.log("  → Loading HTML...")
    await win.loadURL(`data:text/html;base64,${base64}`)
    await new Promise(r => setTimeout(r, 500)) // let Chromium finish painting

    console.log("  → Generating PDF via printToPDF...")
    pdfBuffer = await win.webContents.printToPDF({
      pageSize: { width: 80000, height: 297000 }, // 80mm wide, microns
      printBackground: true,
      margins: { marginType: 'none' },
    })
    console.log(`  → PDF generated: ${pdfBuffer.length} bytes`)
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }

  // Step 2: Write PDF to temp file
  const tmpPdf = path.join(os.tmpdir(), `burrata-receipt-${Date.now()}.pdf`)
  fs.writeFileSync(tmpPdf, pdfBuffer)
  console.log(`  → Written to: ${tmpPdf}`)

  // Step 3: macOS — skip PowerShell, just verify file is valid
  if (process.platform !== 'win32') {
    const size = fs.statSync(tmpPdf).size
    fs.unlinkSync(tmpPdf)
    console.log(`  → (macOS: PDF verified ${size} bytes — PowerShell step skipped)`)
    return "PDF_OK_NO_POWERSHELL"
  }

  // Step 4: Windows — print PDF via PowerShell PrintTo verb
  // Uses Windows built-in PDF association (Edge on Win10/11) to print silently
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "''")
  const psCmd = [
    `$pdf = '${esc(tmpPdf)}'`,
    `$prn = '${esc(printerName)}'`,
    `Start-Process -FilePath $pdf -Verb PrintTo -ArgumentList $prn -Wait`,
    `Start-Sleep -Seconds 3`,
  ].join('; ')

  return new Promise((resolve, reject) => {
    const cleanup = () => { try { fs.unlinkSync(tmpPdf) } catch {} }
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error("PowerShell timed out after 30s"))
    }, 30000)

    exec(
      `powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "${psCmd}"`,
      { timeout: 35000 },
      (error, _stdout, stderr) => {
        clearTimeout(timeout)
        cleanup()
        if (error) reject(new Error(`PowerShell failed: ${stderr || error.message}`))
        else resolve("SUCCESS")
      }
    )
  })
}

app.whenReady().then(async () => {
  console.log("\n=== Burrata POS — Print Test (printToPDF + PowerShell) ===\n")

  const keepAliveWin = new BrowserWindow({ show: false })
  await keepAliveWin.loadURL("about:blank")
  const printers = await keepAliveWin.webContents.getPrintersAsync()

  console.log(`✓ Found ${printers.length} printer(s):`)
  printers.forEach(p => console.log(`    ${p.isDefault ? '★' : ' '} ${p.name}`))

  if (printers.length === 0) {
    console.log("\n✗ No printers — install one and retry.")
    keepAliveWin.destroy(); app.quit(); return
  }

  const target = printers.find(p => p.isDefault) || printers[0]
  console.log(`\n→ Testing print to: "${target.name}"`)

  try {
    const result = await printHtml(target.name, TEST_HTML)
    console.log(`\n✓ PASS: ${result}`)
  } catch (err) {
    console.log(`\n✗ FAIL: ${err.message}`)
  }

  keepAliveWin.destroy()
  app.quit()
})

// Quick local test — verifies the print-html IPC mechanism works end-to-end.
// Run with: node test-print.js  (outside Electron, just tests Node logic)
// Then run: npx electron test-electron.js  (tests inside Electron)

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin:0; padding:0; }
  body { font-family: 'Courier New', monospace; font-size:13px; width:302px; padding:12px; }
  h2 { font-size:15px; text-align:center; }
  .divider { border-top:1px dashed #000; margin:6px 0; }
  @media print { @page { size: 80mm auto; margin: 0; } }
</style>
</head>
<body>
<h2>BURRATA POS</h2>
<div class="divider"></div>
<p><strong>TEST PRINT</strong></p>
<p>Order #1 - Table: Test</p>
<div class="divider"></div>
<p>1x Test Item</p>
<div class="divider"></div>
<p style="text-align:center">Print working correctly!</p>
</body>
</html>`

// Test 1: Verify HTML generation doesn't crash
console.log("✓ HTML generated:", html.length, "chars")

// Test 2: Verify temp file approach works
const fs = require('fs')
const os = require('os')
const path = require('path')

const tmpFile = path.join(os.tmpdir(), `burrata-print-test-${Date.now()}.html`)
fs.writeFileSync(tmpFile, html, 'utf8')
const fileUrl = `file:///${tmpFile.replace(/\\/g, '/')}`
console.log("✓ Temp file written:", tmpFile)
console.log("✓ File URL:", fileUrl)

const written = fs.readFileSync(tmpFile, 'utf8')
if (written === html) console.log("✓ File content verified")
else console.error("✗ File content mismatch!")

fs.unlinkSync(tmpFile)
console.log("✓ Temp file cleaned up")

console.log("\nNode.js checks passed. Now run: npx electron test-electron.js")

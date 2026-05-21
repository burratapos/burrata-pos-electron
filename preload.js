const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("electronAPI", {
  isPrintServer: true,
  getPrinters:   ()                      => ipcRenderer.invoke("get-printers"),
  printHtml:     (printerName, html)     => ipcRenderer.invoke("print-html", printerName, html),
})

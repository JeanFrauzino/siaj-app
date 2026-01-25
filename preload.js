// preload.js (Atualizado)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // A nova função que dispara todo o processo
    startProcess: () => ipcRenderer.invoke('process:start'),
    // Canal para receber as atualizações de progresso e status
    onUpdate: (callback) => ipcRenderer.on('update-status', (_event, data) => callback(data)),

    // --- NOVAS FUNÇÕES ---
    // (Req 1, 2, 4, 5, 6)
    // Função para buscar as configurações salvas do main.js
    getSettings: () => ipcRenderer.invoke('settings:get'),
    
    // Função para enviar as novas configurações para o main.js salvar
    
    saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
    on: (channel, func) => ipcRenderer.on(channel, (event, ...args) => func(...args)), 
    restartWhatsapp: () => ipcRenderer.invoke('whatsapp:restart'), 
    sendWhatsappTest: (number) => ipcRenderer.invoke('whatsapp:test', number), 
    restartApp: () => ipcRenderer.invoke('app:restart'),
    getMachineId: () => ipcRenderer.invoke('system:get-hwid'),
});
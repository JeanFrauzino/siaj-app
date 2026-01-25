// main.js (Final e Corrigido)
const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const { autoUpdater } = require('electron-updater'); // <--- NOVO
const licenseService = require('./services/licenseService'); // <--- NOVO
const path = require('path');
const fs = require('fs/promises');
const { PDFDocument } = require('pdf-lib');
const notifier = require('./telegramNotifier');
const aiHandler = require('./aiHandler');
const Store = require('electron-store');
const cron = require('node-cron');
const emailService = require('./services/emailService');

// Serviços
const scraperService = require('./services/scraperService');
const pdfService = require('./services/pdfService');
const whatsappService = require('./services/whatsappService');

const store = new Store();
let mainWindow;
let tray;
let scheduledTask;
let isTaskRunning = false;
let isWaitingRetry = false;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200, height: 800,
        icon: path.join(__dirname, 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true, nodeIntegration: false
        }
    });
    mainWindow.loadFile('index.html');

    if (app.isPackaged) {
    // Verifica atualizações a cada 1 hora (opcional) ou apenas na abertura
    autoUpdater.checkForUpdatesAndNotify();
}

// 1. Verificando...
autoUpdater.on('checking-for-update', () => {
    if(mainWindow) mainWindow.webContents.send('update-status', { status: 'info', message: '🔄 Verificando atualizações...' });
});

// 2. Atualização Disponível (Iniciando Download)
autoUpdater.on('update-available', () => {
    if(mainWindow) mainWindow.webContents.send('update-status', { status: 'download_start', message: '⬇️ Nova versão encontrada. Baixando...' });
});

// 3. Progresso do Download (Barra de Progresso)
autoUpdater.on('download-progress', (progressObj) => {
    if(mainWindow) {
        // Envia a porcentagem para a sua barra de progresso existente no renderer
        mainWindow.webContents.send('update-status', { 
            status: 'download_progress', 
            progress: progressObj.percent,
            message: `⬇️ Baixando: ${Math.round(progressObj.percent)}%` 
        });
    }
});

// 4. Download Concluído (Hora de Instalar)
autoUpdater.on('update-downloaded', () => {
    if(mainWindow) mainWindow.webContents.send('update-status', { status: 'info', message: '✅ Atualização pronta.' });
    
    dialog.showMessageBox({
        type: 'info',
        title: 'Atualização Pronta',
        message: 'A nova versão do SIAJ foi baixada. O aplicativo será reiniciado para atualizar.',
        buttons: ['Reiniciar Agora']
    }).then(() => {
        setImmediate(() => autoUpdater.quitAndInstall());
    });
});

// 5. Erro
autoUpdater.on('error', (err) => {
    if(mainWindow) mainWindow.webContents.send('update-status', { status: 'error', message: 'Erro na atualização (segue normal).' });
    console.error("Erro no AutoUpdater:", err);
});



    // [CORREÇÃO 1] Caminho da sessão definido aqui dentro para segurança
    const sessionPath = path.join(app.getPath('userData'), 'whatsapp-session');
    
    // Cria a pasta e inicia
    fs.mkdir(sessionPath, { recursive: true }).catch(console.error);
    whatsappService.init(mainWindow, sessionPath);

    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });
}

function createTray() {
    const iconPath = path.join(__dirname, 'icon.png');
    tray = new Tray(iconPath);
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Mostrar Analisador', click: () => { mainWindow.show(); mainWindow.focus(); } },
        { type: 'separator' },
        { label: 'Sair', click: () => { app.isQuitting = true; app.quit(); } } // Força a saída real
    ]);
    tray.setToolTip('SIAJ-GO');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => { mainWindow.show(); });
}

/* app.whenReady().then(() => {
    createWindow();
    createTray();
    updateSchedule();
    cleanupOldDownloads().catch(console.error);
}); */


app.whenReady().then(async () => {
    
    // 1. Checa o Status da Licença
    const check = await licenseService.validate();

    // Se o usuário clicou em SAIR, fecha tudo.
    if (check.status === 'EXIT') {
        app.quit();
        return;
    }

    // 2. Cria a janela (seja para usar ou para configurar)
    createWindow();

    // 3. SE O STATUS FOR DE BLOQUEIO -> TRAVA A TELA
    if (check.status === 'LOCK_SCREEN') {
        // Espera a janela carregar para mandar o comando
        mainWindow.webContents.on('did-finish-load', () => {
            mainWindow.webContents.send('app-lock-mode');
        });
    } else {
        // Se for VALID, carrega o resto normal
        createTray();
        updateSchedule();
        cleanupOldDownloads().catch(console.error);
    }
});


app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow.show();
});

// [CORREÇÃO 2] Fechamento Seguro (Graceful Shutdown)
// Isso impede que a sessão do WhatsApp corrompa ao fechar
app.on('before-quit', async (event) => {
    if (app.isCleanedUp) return; // Se já limpou, deixa fechar

    event.preventDefault(); // Pausa o fechamento
    app.isQuitting = true;
    
    console.log("[Main] Fechando... Salvando sessão WhatsApp.");
    
    try {
        await whatsappService.stop(); // Espera salvar
    } catch (err) {
        console.error("Erro ao fechar WhatsApp:", err);
    }
    
    app.isCleanedUp = true; // Marca como limpo
    app.quit(); // Fecha de vez
});

const { machineIdSync } = require('node-machine-id'); // Certifique-se de importar

ipcMain.handle('system:get-hwid', () => {
    return machineIdSync();
});


ipcMain.handle('whatsapp:test', async (event, number) => {
    console.log(`[Main] Testando envio de WhatsApp para: ${number}`);
    
    if (!number) return { success: false, message: "Número vazio." };

    try {
        const msg = "🔔 *Teste SIAJ-GO*\n\nSe você recebeu esta mensagem, o sistema de notificações está funcionando perfeitamente! ✅";
        
        // Chama o serviço mandando null no lugar do arquivo
        const result = await whatsappService.sendMessage(number, msg, null);
        
        return { success: result };
    } catch (error) {
        console.error("Erro no teste:", error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('app:restart', () => {
    app.relaunch(); // Prepara o reinício
    app.exit(0);    // Mata o processo atual imediatamente
});


// --- IPC Settings ---
ipcMain.handle('settings:get', () => store.get('userSettings', {}));
ipcMain.handle('settings:save', (event, settings) => {
    try {
        store.set('userSettings', settings);
        updateSchedule();
        return { success: true };
    } catch (error) { return { success: false, error: error.message }; }
});

// [CORREÇÃO 3] Restart com o caminho correto
ipcMain.handle('whatsapp:restart', async () => {
    console.log("[Main] Reiniciando serviço WhatsApp...");
    const sessionPath = path.join(app.getPath('userData'), 'whatsapp-session');
    // Agora passamos o sessionPath correto para o reload saber onde limpar
    await whatsappService.reload(mainWindow, sessionPath);
    return true;
});

ipcMain.handle('process:start', async () => {
    const settings = store.get('userSettings', {});
    settings.downloadsPath = app.getPath('downloads');
    await cleanupOldDownloads();
    return await runProcessLogic(settings);
});

// --- AUXILIARES ---

/*
function updateSchedule() {
    if (scheduledTask) scheduledTask.stop();
    const settings = store.get('userSettings', {});
    if (settings.scheduleEnabled && settings.scheduleCron && cron.validate(settings.scheduleCron)) {
        scheduledTask = cron.schedule(settings.scheduleCron, async () => {
            if (mainWindow && mainWindow.isVisible()) {
                mainWindow.webContents.send('update-status', { status: 'analysis_start', totalFiles: 0, message: 'Iniciando via agendamento...' });
            }
            const currentSettings = store.get('userSettings', {});
            currentSettings.downloadsPath = app.getPath('downloads');
            try { await runProcessLogic(currentSettings); } catch (err) { console.error("Erro agendado:", err); }
        });
        scheduledTask.start();
    }
}
*/

function updateSchedule() {
    if (scheduledTask) {
        scheduledTask.stop();
        scheduledTask = null;
    }

    const settings = store.get('userSettings', {});
    console.log(`[Cron] Configurando... Hora Sistema: ${new Date().toLocaleTimeString('pt-BR')}`);

    if (settings.scheduleEnabled && settings.scheduleCron) {
        const cleanCron = settings.scheduleCron.trim();
        
        if (!cron.validate(cleanCron)) {
            console.error(`[Cron] ❌ Cron inválido: "${cleanCron}"`);
            return;
        }

        console.log(`[Cron] Agendado para: "${cleanCron}"`);
        
        scheduledTask = cron.schedule(cleanCron, async () => {
            console.log(`\n[Cron] ⏰ GATILHO ACIONADO às ${new Date().toLocaleTimeString('pt-BR')}`);
            
            if (isTaskRunning || isWaitingRetry) {
                console.log("[Cron] ⚠️ Tarefa ocupada/aguardando. Pulando.");
                return;
            }
            
            // BLINDAGEM DE ERRO
            try {
                console.log("[Cron] Chamando startSmartSchedule...");
                await startSmartSchedule(1, 2);
            } catch (err) {
                console.error("[Cron] ❌ ERRO CRÍTICO AO INICIAR:", err);
            }
        });
        
        scheduledTask.start();
        console.log("[Cron] ✅ Tarefa ativa.");
    }
}

async function startSmartSchedule(attempt = 1, maxAttempts = 2) {
    console.log(`[SmartSchedule] >>> INICIANDO FUNÇÃO (Tentativa ${attempt}) <<<`);

    try {
        const settings = store.get('userSettings', {});
        if (!settings) throw new Error("Não foi possível ler as configurações do usuário.");

        console.log("[SmartSchedule] Inicializando Notificador...");
        notifier.init(settings.telegramToken, settings.telegramChatId);

        const today = new Date().toLocaleDateString('pt-BR');
        console.log(`[SmartSchedule] Data de hoje: ${today}. Iniciando verificação no site...`);

        // Verifica se o serviço existe
        if (!scraperService || !scraperService.checkLatestDjeDate) {
            throw new Error("Serviço scraperService.checkLatestDjeDate não está definido! Verifique o arquivo scraperService.js");
        }

        const siteDate = await scraperService.checkLatestDjeDate();
        console.log(`[SmartSchedule] Data retornada pelo site: "${siteDate}"`);

        // 1. DATA IGUAL
        if (siteDate === today) {
            console.log("[SmartSchedule] ✅ Datas batem! Iniciando download...");
            await notifier.sendMessage(`✅ Diário de hoje (${today}) detectado! Iniciando...`);
            
            settings.downloadsPath = app.getPath('downloads');
            await runProcessLogic(settings);
            return;
        }

        // 2. DATA DIFERENTE
        console.log(`[SmartSchedule] ⚠️ Data diferente. Site: ${siteDate} | Hoje: ${today}`);
        
        if (attempt < maxAttempts) {
            const waitMinutes = 30; // Pode diminuir para 1 min para testar
            const waitMs = waitMinutes * 60 * 1000;
            
            console.log(`[SmartSchedule] Agendando re-tentativa para daqui a ${waitMinutes} min.`);
            
            await notifier.sendMessage(
                `⚠️ *Aviso de Agendamento*\n\nTJGO mostra: *${siteDate || 'Nada'}*\nHoje é: *${today}*\n⏳ Tentando novamente em ${waitMinutes} min.`
            );

            isWaitingRetry = true;
            setTimeout(async () => {
                isWaitingRetry = false;
                await startSmartSchedule(attempt + 1, maxAttempts);
            }, waitMs);

        } else {
            console.log("[SmartSchedule] ❌ Tentativas esgotadas.");
            await notifier.sendMessage(`❌ *Agendamento Cancelado*\nDiário de hoje não encontrado após ${maxAttempts} tentativas.`);
        }

    } catch (error) {
        console.error("[SmartSchedule] ❌ ERRO INTERNO:", error);
        if (notifier) await notifier.sendMessage(`❌ Erro no Agendamento: ${error.message}`);
    }
}




async function cleanupOldDownloads() {
    const settings = store.get('userSettings', {});
    const retentionDays = settings.retentionDays;
    if (!retentionDays || retentionDays <= 0) return;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    const downloadsBaseDir = path.join(app.getPath('downloads'), 'TJGO_Diarios');
    const extractionsBaseDir = path.join(app.getPath('userData'), 'extractions');

    const cleanDir = async (baseDir) => {
        try {
            await fs.access(baseDir);
            const dateFolders = await fs.readdir(baseDir, { withFileTypes: true });
            for (const folder of dateFolders) {
                if (folder.isDirectory()) {
                    const folderDate = new Date(folder.name);
                    if (!isNaN(folderDate) && folderDate < cutoffDate) {
                        await fs.rm(path.join(baseDir, folder.name), { recursive: true, force: true });
                    }
                }
            }
        } catch (error) { if (error.code !== 'ENOENT') console.error(`Erro limpeza ${baseDir}:`, error); }
    };
    await cleanDir(downloadsBaseDir);
    await cleanDir(extractionsBaseDir);
}

// --- LÓGICA DE ORQUESTRAÇÃO ---
async function runProcessLogic(SETTINGS) {
    if (isTaskRunning) throw new Error("Processo já em andamento.");
    isTaskRunning = true;

    const sendStatus = (data) => { if (mainWindow) mainWindow.webContents.send('update-status', data); };

    notifier.init(SETTINGS.telegramToken, SETTINGS.telegramChatId);
    aiHandler.init(SETTINGS.googleApiKey);

    const emailBatchList = [];

    try {
        const startTime = Date.now();
        if (!SETTINGS.downloadsPath) throw new Error("Caminho de Downloads não definido.");

        const date = new Date().toISOString().slice(0, 10);
        const downloadDir = path.join(SETTINGS.downloadsPath, 'TJGO_Diarios', date);
        const skipDownload = SETTINGS.skipDownload || false;

        let filesInDownloadDir;
        if (skipDownload) {
            await notifier.sendMessage(`--- MODO TESTE: Download pulado ---`);
            filesInDownloadDir = await fs.readdir(downloadDir);
        } else {
            filesInDownloadDir = await scraperService.downloadPdfs(downloadDir, sendStatus);
        }

        const pdfFiles = filesInDownloadDir.filter(file => path.extname(file).toLowerCase() === '.pdf');
        if (pdfFiles.length === 0) {
            await notifier.sendMessage('⚠️ Nenhum PDF encontrado.');
            return { totalFiles: 0, totalExtractions: 0, extractedFiles: [], duration: '0s' };
        }

        sendStatus({ status: 'analysis_start', totalFiles: pdfFiles.length });

        const baseKeywords = [
            'suscitação de dúvida', 
            'comarca de morrinhos'
        ];
        const userKeywords = SETTINGS.keywords || [];
        const keywordsToSearch = [...new Set([...baseKeywords, ...userKeywords])];

        let totalExtractions = 0;
        const allExtractedFiles = [];

        for (let i = 0; i < pdfFiles.length; i++) {
            const fileName = pdfFiles[i];
            const filePath = path.join(downloadDir, fileName);

            sendStatus({ status: 'file_start', currentFileNumber: i + 1, currentFileName: fileName, totalFiles: pdfFiles.length });
            await notifier.sendMessage(`📄 Analisando ${i + 1}/${pdfFiles.length}: ${fileName}`);

            const dataBuffer = await fs.readFile(filePath);
            const processesToExtract = await pdfService.findAndValidateProcesses(dataBuffer, keywordsToSearch, sendStatus);

            if (processesToExtract.length > 0) {
                const originalFileNameWithoutExt = path.basename(fileName, '.pdf');
                const userDataPath = app.getPath('userData');
                const outputDir = path.join(userDataPath, 'extractions', date, originalFileNameWithoutExt);
                await fs.mkdir(outputDir, { recursive: true });

                const originalPdf = await PDFDocument.load(Buffer.from(dataBuffer));

                for (const processData of processesToExtract) {
                    if (processData.startPage > processData.endPage) continue;

                    const newPdf = await PDFDocument.create();
                    const pageIndices = Array.from({ length: (processData.endPage - processData.startPage) + 1 }, (_, k) => (processData.startPage - 1) + k);
                    const copiedPages = await newPdf.copyPages(originalPdf, pageIndices);
                    copiedPages.forEach(page => newPdf.addPage(page));
                    const newPdfBytes = await newPdf.save();

                    const safeKeyword = pdfService.normalizeText(processData.keyword).replace(/\s/g, '_').replace(/[\\/:"*?<>|]/g, '');
                    const newFileName = `Processo_${processData.processNumber.replace(/[.\-/]/g, '')}_KW_${safeKeyword}.pdf`;
                    const outputPath = path.join(outputDir, newFileName);
                    await fs.writeFile(outputPath, newPdfBytes);

                    const reportJson = await aiHandler.analyzePdfWithAI(outputPath);
                    if (reportJson) {
                        const extractedFileName = path.basename(outputPath);
                        const summary = reportJson.resumoDoCaso || "Resumo não disponível.";
                        const caption = `📋 *SIAJ-GO*\nProcesso: ${processData.processNumber}\nResumo: ${summary}`;
                        await notifier.sendDocumentWithCaption(outputPath, caption);

                        if (SETTINGS.emailEnabled) {
                            emailBatchList.push({ processData, aiReport: reportJson, pdfPath: outputPath });
                        }

                        if (SETTINGS.whatsappEnabled && SETTINGS.whatsappNumber) {
                            sendStatus({ status: 'info', message: '📱 Enviando WhatsApp...' });
                            const whatsMsg = `🤖 *SIAJ-GO*\n\n📂 *Proc:* ${processData.processNumber}\n🔑 *Ref:* ${processData.keyword}\n\n📄 *Resumo:* ${summary}`;
                            await whatsappService.sendMessage(SETTINGS.whatsappNumber, whatsMsg, outputPath);
                        }
                    }
                    totalExtractions++;
                    allExtractedFiles.push(path.join(originalFileNameWithoutExt, newFileName));
                }
            }
        }

        if (emailBatchList.length > 0) {
            sendStatus({ status: 'info', message: `📧 Enviando Resumo (${emailBatchList.length} processos)...` });
            await emailService.sendBatchReport(SETTINGS, emailBatchList);
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(2) + ' segundos';
        await notifier.sendMessage(`🎉 Finalizado!\n${totalExtractions} processos.\nTempo: ${duration}`);
        return { totalFiles: pdfFiles.length, totalExtractions, extractedFiles: allExtractedFiles, duration };

    } catch (err) {
        console.error("Erro fatal:", err);
        await notifier.sendMessage(`❌ ERRO FATAL: ${err.message}`);
        throw err;
    } finally {
        isTaskRunning = false;
    }
}
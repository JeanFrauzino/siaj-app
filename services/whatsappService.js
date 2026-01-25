const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

let client = null;
let isReady = false;

function removeLockFile(basePath) {
    try {
        const sessionDir = path.join(basePath, 'session-siaj-client');
        const lockFile = path.join(sessionDir, 'SingletonLock');
        if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
    } catch (error) {}
}

// --- FUNÇÃO CIRÚRGICA: O PULO DO GATO ---
// Isso injeta um código no navegador para impedir que o erro 'markedUnread' trave o robô
async function injectPatch(client) {
    try {
        if (client && client.pupPage) {
            await client.pupPage.evaluate(() => {
                // Sobrescreve a função quebrada por uma função vazia que sempre retorna "Sucesso"
                if (window.WWebJS) {
                    window.WWebJS.sendSeen = async () => { return true; };
                    console.log("PATCH: WWebJS.sendSeen neutralizado com sucesso.");
                }
            });
        }
    } catch (e) {
        console.log("[Patch] Erro leve ao injetar patch (pode ser ignorado):", e.message);
    }
}

function init(mainWindow, customSessionPath) {
    if (client) return;

    const authPath = customSessionPath || path.join(process.cwd(), 'whatsapp-session');
    console.log(`[WhatsApp] Inicializando (Com Patch Anti-Erro) em: ${authPath}`);

    removeLockFile(authPath);

    client = new Client({
        authStrategy: new LocalAuth({ 
            clientId: 'siaj-client',
            dataPath: authPath 
        }),
        // Usamos remote para garantir uma base estável, mesmo com o patch
        webVersionCache: {
            type: "remote",
            remotePath: "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html",
        },
        puppeteer: {
            executablePath: puppeteer.executablePath(),
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-extensions',
                '--bypass-csp' 
            ]
        }
    });

    client.on('qr', (qr) => {
        console.log('[WhatsApp] QR Code gerado.');
        qrcode.toDataURL(qr, (err, url) => {
            if (mainWindow && !mainWindow.isDestroyed() && !err) {
                mainWindow.webContents.send('whatsapp-qr', url);
                mainWindow.webContents.send('update-status', { status: 'info', message: '📸 Escaneie o QR Code' });
            }
        });
    });

    client.on('authenticated', () => {
        console.log('[WhatsApp] Autenticado!');
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('whatsapp-status', 'Autenticado...');
        }
    });

    client.on('ready', async () => {
        console.log('[WhatsApp] Cliente Pronto!');
        isReady = true;
        
        // APLICA O PATCH ASSIM QUE CONECTA
        await injectPatch(client);

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('whatsapp-ready');
            mainWindow.webContents.send('whatsapp-status', 'Conectado ✅');
        }
    });

    client.on('disconnected', (reason) => {
        isReady = false;
        console.log('[WhatsApp] Desconectado:', reason);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('whatsapp-closed');
            mainWindow.webContents.send('whatsapp-status', 'Desconectado ❌');
        }
        setTimeout(() => reload(mainWindow, customSessionPath), 5000);
    });

    client.initialize().catch(err => {
        console.error("Erro Fatal Init WhatsApp:", err.message);
        setTimeout(() => reload(mainWindow, customSessionPath), 5000);
    });
}

async function reload(mainWindow, customSessionPath) {
    console.log('[WhatsApp] Reiniciando serviço...');
    if (client) {
        try { await client.destroy(); } catch (e) {}
        client = null;
        isReady = false;
    }
    setTimeout(() => init(mainWindow, customSessionPath), 3000);
}

async function stop() {
    if (client) {
        try { await client.destroy(); } catch (e) {}
        client = null;
        isReady = false;
    }
}

async function sendMessage(number, text, filePath) {
    if (!client || !isReady) {
        console.log('[WhatsApp] ERRO: Cliente não está pronto.');
        return false;
    }

    // 1. Limpeza do número
    let cleanNumber = number.replace(/\D/g, '');
    if (!cleanNumber.startsWith('55')) cleanNumber = '55' + cleanNumber;
    const tempId = `${cleanNumber}@c.us`;

    try {
        // --- CORREÇÃO DO "NO LID" (O Pulo do Gato) ---
        // Antes de enviar, perguntamos ao servidor qual é o ID real deste número.
        // Isso força o WhatsApp a carregar o LID na memória, prevenindo o erro.
        const contact = await client.getNumberId(tempId);
        
        // Se o número não existir no WhatsApp, aborta.
        if (!contact) {
            console.log(`[WhatsApp] Erro: Número não registrado no WhatsApp: ${cleanNumber}`);
            return false;
        }

        // Usamos o _serialized retornado pelo servidor, que é a credencial válida
        const finalId = contact._serialized;

        // --- TENTATIVA 1: VIA BIBLIOTECA PADRÃO ---
        if (filePath && fs.existsSync(filePath)) {
            const media = MessageMedia.fromFilePath(filePath);
            await client.sendMessage(finalId, media, { caption: text });
        } else {
            await client.sendMessage(finalId, text);
        }
        
        console.log(`[WhatsApp] Sucesso (Padrão): ${cleanNumber}`);
        return true;

    } catch (error) {
        // Se cair aqui, é porque a API falhou mesmo com o ID correto.
        console.log(`[WhatsApp] Falha API (${error.message}). Iniciando Modo de Guerra (DOM)...`);
            
        try {
            // --- TENTATIVA 2: BYPASS VIA DOM (Imune a Webpack) ---
            // Não tentamos mais injetar em Store.SendMessage (instável).
            // Vamos direto para a automação de interface (Digitação).
            
            // 1. Força a abertura do chat pela URL (Garante que a UI carregue o chat certo)
            await client.pupPage.evaluate((target) => {
                // Usa o router interno para navegar sem reload
                window.open(`https://web.whatsapp.com/send?phone=${target}`, '_self');
            }, cleanNumber);

            // 2. Aguarda o carregamento do chat (procura pelo header ou input)
            // Espera seletor da barra de chat ou título
            await client.pupPage.waitForSelector('div[contenteditable="true"], div[title="Digite uma mensagem"]', { timeout: 15000 });
            
            // Pequeno delay para garantir foco
            await new Promise(r => setTimeout(r, 1000));

            // 3. Digita e Envia
            const inputBox = await client.pupPage.$('div[contenteditable="true"][data-tab="10"]') || 
                             await client.pupPage.$('div[title="Digite uma mensagem"]');

            if (inputBox) {
                // Limpa input caso tenha lixo
                await client.pupPage.evaluate(el => el.innerHTML = '', inputBox); 
                
                if (filePath && fs.existsSync(filePath)) {
                    // Se tiver arquivo no modo fallback, é complexo, então enviamos só o texto
                    // ou implementamos o attach via input[type=file] se necessário.
                    // Por segurança no fallback, mandamos o texto avisando.
                    console.log('[WhatsApp] Aviso: Envio de mídia não suportado no modo Fallback DOM.');
                    await inputBox.type(text + " [Mídia não enviada no modo de contingência]");
                } else {
                    await inputBox.type(text);
                }
                
                await new Promise(r => setTimeout(r, 500)); // Delay humano
                await client.pupPage.keyboard.press('Enter');
                
                console.log(`[WhatsApp] Sucesso (Digitação Manual DOM): ${cleanNumber}`);
                return true;
            } else {
                throw new Error("Input de texto não encontrado no DOM.");
            }

        } catch (bypassError) {
            console.error(`[WhatsApp] ERRO FATAL (${cleanNumber}): Todas as tentativas falharam.`, bypassError.message);
            return false;
        }
    }
}

module.exports = { init, sendMessage, reload, stop };
// telegramNotifier.js (Versão Final Ajustada para Limites)

const { Telegraf } = require('telegraf');

// --- CONSTANTES DE LIMITE DO TELEGRAM ---
// Limite para mensagens de texto puro (4096 é o oficial)
const MAX_MESSAGE_LENGTH = 4096;
// Limite para legendas (captions) de arquivos/fotos (1024 é o oficial)
// Deixamos 1020 para ter uma pequena margem de segurança para os "..."
const MAX_CAPTION_LENGTH = 1020;

let bot;
let chatId;

/**
 * Inicializa o módulo do Telegram com configurações dinâmicas.
 * @param {string} botToken O token do bot (vindo do electron-store).
 * @param {string} chatTargetId O ID do chat (vindo do electron-store).
 */
function init(botToken, chatTargetId) {
    if (!botToken || !chatTargetId) {
        console.warn("[Telegram] AVISO: Credenciais do Telegram não fornecidas. Notificações desativadas.");
        bot = null;
        chatId = null;
        return;
    }

    // Otimização: Se o bot já existe com o mesmo token,
    // apenas atualizamos o chatId.
    if (bot && bot.token === botToken) {
        chatId = chatTargetId;
        return;
    }

    try {
        bot = new Telegraf(botToken);
        chatId = chatTargetId;
        console.log("[Telegram] Notificador do Telegram inicializado.");
    } catch (error) {
        console.error("[Telegram] ERRO ao criar instância do Telegraf:", error.message);
        bot = null;
        chatId = null;
    }
}

/**
 * "Escapa" caracteres especiais para o formato MarkdownV2 do Telegram.
 * @param {string} text O texto a ser higienizado.
 * @returns {string} O texto seguro para envio.
 */
function escapeMarkdown(text) {
    if (typeof text !== 'string') return '';
    // A API do Telegram (MarkdownV2) requer que estes caracteres sejam escapados.
    const charsToEscape = ['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'];
    let escapedText = text;
    for (const char of charsToEscape) {
        escapedText = escapedText.replace(new RegExp('\\' + char, 'g'), '\\' + char);
    }
    return escapedText;
}

/**
 * Envia uma mensagem de texto simples.
 * Se a mensagem for maior que o limite, ela será dividida em várias partes.
 * @param {string} message O texto da mensagem a ser enviada.
 */
async function sendMessage(message) {
    if (!bot || !chatId) {
        console.warn("[Telegram] Tentativa de envio sem 'bot' ou 'chatId' inicializado. Mensagem ignorada.");
        return;
    }

    // --- LÓGICA DE DIVISÃO PARA MENSAGENS LONGAS ---
    try {
        if (message.length <= MAX_MESSAGE_LENGTH) {
            // Se for pequena, escapa e envia normalmente
            await bot.telegram.sendMessage(chatId, escapeMarkdown(message), { parse_mode: 'MarkdownV2' });
        } else {
            // Se for grande, divide em blocos
            console.log(`[Telegram] Mensagem longa detectada (${message.length} chars). Dividindo...`);
            
            // Regex para dividir a string em pedaços de até MAX_MESSAGE_LENGTH
            const regex = new RegExp(`[\\s\\S]{1,${MAX_MESSAGE_LENGTH}}`, 'g');
            const chunks = message.match(regex) || [];

            for (let i = 0; i < chunks.length; i++) {
                // Escapa cada pedaço individualmente antes de enviar
                const escapedChunk = escapeMarkdown(chunks[i]);
                await bot.telegram.sendMessage(chatId, escapedChunk, { parse_mode: 'MarkdownV2' });
                
                // Pequena pausa para não sobrecarregar a API em envios seguidos
                if (i < chunks.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            }
        }
    } catch (error) {
        console.error("[Telegram] ERRO ao enviar mensagem:", error.message);
    }
}

/**
 * Envia um documento (PDF) com uma legenda.
 * Se a legenda for maior que o limite, ela será cortada.
 * @param {string} filePath O caminho para o arquivo local a ser enviado.
 * @param {string} caption O texto que servirá como legenda do arquivo.
 */
async function sendDocumentWithCaption(filePath, caption) {
    if (!bot || !chatId) {
        console.warn("[Telegram] Tentativa de envio de documento sem 'bot' ou 'chatId' inicializado. Documento ignorado.");
        return;
    }

    // --- LÓGICA DE CORTE PARA LEGENDAS LONGAS ---
    let finalCaption = caption;
    if (finalCaption.length > MAX_CAPTION_LENGTH) {
        console.warn(`[Telegram] Legenda do documento muito longa (${finalCaption.length} chars). Cortando para evitar erro.`);
        // Corta o texto original (antes de escapar) e adiciona "..."
        finalCaption = finalCaption.substring(0, MAX_CAPTION_LENGTH) + '...';
    }
    // -------------------------------------------

    try {
        await bot.telegram.sendDocument(
            chatId,
            { source: filePath }, 
            // Escapamos a legenda (possivelmente cortada) aqui
            { caption: escapeMarkdown(finalCaption), parse_mode: 'MarkdownV2' }
        );
    } catch (error) {
        console.error("[Telegram] ERRO ao enviar documento:", error.message);
    }
}

module.exports = { 
    init,
    sendMessage, 
    sendDocumentWithCaption 
};
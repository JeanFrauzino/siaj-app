// aiHandler.js (Versão API Key - Portátil)

const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs/promises');
const path = require('path');
// Importação condicional para evitar erro se notifier não estiver pronto
let notifier = null;
try { notifier = require('./telegramNotifier'); } catch (e) {}

// --- Configuração PDF.js (Mantida para garantir leitura) ---
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
pdfjsLib.GlobalWorkerOptions.standardFontDataUrl = path.join(__dirname, 'node_modules/pdfjs-dist/standard_fonts/');
pdfjsLib.GlobalWorkerOptions.verbosity = 0;

let genAI = null;
let model = null;
let isInitialized = false;

// Agora recebemos a API KEY, não o Project ID
function init(apiKey) {
    if (!apiKey) {
        console.warn("[AI Handler] AVISO: API Key não fornecida.");
        isInitialized = false;
        return;
    }

    try {
        genAI = new GoogleGenerativeAI(apiKey);
        // Usando o modelo flash (rápido e barato)
        model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        isInitialized = true;
        console.log("[AI Handler] Cliente Google AI Studio inicializado.");
    } catch (error) {
        console.error("[AI Handler] ERRO ao inicializar:", error.message);
        isInitialized = false;
    }
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function analyzePdfWithAI(filePath) {
    const fileName = path.basename(filePath);

    if (!isInitialized || !model) {
        console.error(`[AI Handler] Tentativa de análise sem API Key.`);
        if(notifier) await notifier.sendMessage(`❌ ERRO IA: API Key não configurada.`);
        return null;
    }

    const pdfText = await getPdfText(filePath);
    if (!pdfText) return null;

    const prompt = createPromptA(pdfText);
    const MAX_RETRIES = 3;
    let currentAttempt = 0;

    while (currentAttempt < MAX_RETRIES) {
        try {
            if(notifier) await notifier.sendMessage(`🧠 IA: Analisando *${fileName}*...`);
            
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();
            
            // Limpeza para garantir JSON válido (remove crases se a IA mandar ```json)
            const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
            const reportJson = JSON.parse(jsonStr);
            
            return reportJson;

        } catch (error) {
            currentAttempt++;
            console.error(`[AI Handler] ERRO Tentativa ${currentAttempt}:`, error.message);
            
            if (currentAttempt < MAX_RETRIES) {
                const waitTime = 5000 * currentAttempt;
                if(notifier) await notifier.sendMessage(`🟡 Erro IA. Tentando novamente em ${waitTime/1000}s...`);
                await delay(waitTime);
            } else {
                if(notifier) await notifier.sendMessage(`❌ ERRO final na análise de IA.`);
                return null;
            }
        }
    }
    return null;
}

// ... (Funções getPdfText e createPromptA permanecem IGUAIS ao seu original) ...
async function getPdfText(filePath) {
    try {
        const data = new Uint8Array(await fs.readFile(filePath));
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise; 
        let allText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            allText += `--- PÁGINA ${i} ---\n` + textContent.items.map(item => item.str).join(' ') + '\n\n';
        }
        return allText;
    } catch (error) {
        console.error(`ERRO Leitura PDF: ${filePath}`);
        return null;
    }
}

function createPromptA(pdfText) {
    // Mantive seu prompt exato
    return `
        Você é um assistente jurídico de elite. Analise o CONTEÚDO de uma SENTENÇA de SUSCITAÇÃO DE DÚVIDA e retorne um objeto JSON com a seguinte estrutura. Sua resposta deve ser APENAS o objeto JSON, sem markdown ou texto extra.
        Estrutura JSON:
        { 
            "suscitante": "...", 
            "suscitado": "...", 
            "objetoDaDuvida": "...", 
            "resultado": "...", 
            "fundamentacaoDaDecisao": "...", 
            "resumoDoCaso": "Resumo conciso (max 800 chars)." 
        }
        Se não encontrar, use "Não informado".
        --- TEXTO ---
        ${pdfText}
        --- FIM ---
    `;
}

module.exports = { init, analyzePdfWithAI };
// services/pdfService.js
const path = require('path');
const fs = require('fs');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js'); 

// Configuração do PDF.js
pdfjsLib.GlobalWorkerOptions.standardFontDataUrl = path.join(__dirname, '../node_modules/pdfjs-dist/standard_fonts/');
pdfjsLib.GlobalWorkerOptions.verbosity = 0;

function normalizeText(text) {
    if (!text) return '';
    // Normaliza removendo acentos e transformando quebras de linha em espaço para busca de palavras-chave
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, ' ');
}

// Log simples para arquivo (opcional, mantive caso precise no futuro)
function logToFile(content) {
    const logPath = path.join(process.cwd(), 'debug_log.txt');
    try { fs.appendFileSync(logPath, content + '\n', 'utf8'); } catch (err) {}
}

function validateSuscitacao(fullProcessText, processNumber) { 
    
    // --- 1. REGEX CORRIGIDA ---
    // Agora que vamos arrumar a extração para ter quebras de linha (\n),
    // podemos usar âncoras ^ e $ com segurança.
    // O [\s\S]*? serve para garantir que pegamos a linha mesmo se tiver sujeira invisível antes/depois
    const REGEX_TITULO_SENTENCA = /^\s*(?:SENTEN[ÇC]A|S\s*E\s*N\s*T\s*E\s*N\s*[ÇC]\s*A)[\s.:-]*$/gm;
    
    // Teste direto na estrutura original (que agora terá quebras de linha)
    if (!REGEX_TITULO_SENTENCA.test(fullProcessText)) {
        return false;
    }
    
    // --- 2. VALIDAÇÃO DE CONTEXTO ---
    const normalizedText = normalizeText(fullProcessText);
    const ALL_PATTERNS = [
        "cuida-se de procedimento de suscitacao de duvida",
        "cuida-se de suscitacao de duvida",
        "Cuida-se de Suscitação de Dúvida",
        "procedimento de suscitacao de duvida",
        "procedimento de duvida",
        "procedimento de DÚVIDA",
        "Cuida-se de procedimento de DÚVIDA",
        "trata-se de acao de duvida",
        "trata-se de pedido de suscitacao de duvida",
        "trata-se de procedimento de suscitacao de duvida",
        "Trata-se de procedimento de SUSCITAÇÃO DE DÚVIDA",
        "trata-se de suscitacao de duvida",
        "Trata-se de suscitação de dúvida",
        "Trata-se de SUSCITAÇÃO DE DÚVIDA",
        "Trata-se de Suscitação de Dúvida Registral",
        "trata-se de suscitacao de duvida inversa",
        "trata-se de suscitacao de duvida direta",
        "suscitacao de duvida direta formulada",
    ];
    const contentRegex = new RegExp(ALL_PATTERNS.join('|'), 'i');
    return contentRegex.test(normalizedText);
}

function validateMorrinhos(fullProcessText, processNumber) { 
    const normalizedText = normalizeText(fullProcessText);
    if (!normalizedText.includes("registro de imoveis")) return false;
    if (!normalizedText.includes("foro extrajudicial")) return false;
    return true;
}

async function mapAllProcessIdentifiers(allPagesText) {
    const processMap = [];
    // Ajuste na regex de processo para pegar mesmo se tiver quebras de linha perto
    const identifierRegexes = [
        /processo\s*(?::|\bnº\b\.?)?\s*(\d{7}-\d{2}\.[^ \n\r]+)/gi,
        /PROAD:\s*(\d+)/gi
    ];
    allPagesText.forEach((pageText, pageIndex) => {
        for (const regex of identifierRegexes) {
            const matches = pageText.matchAll(regex);
            for (const match of matches) {
                processMap.push({ number: match[1].trim(), startPage: pageIndex });
            }
        }
    });
    return processMap.filter((proc, index, self) =>
        index === 0 || proc.number !== self[index - 1].number
    );
}

async function findAndValidateProcesses(dataBuffer, keywordsToSearch, onStatusUpdate) {
    const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(dataBuffer) }).promise; 
    const processesToExtract = [];
    const numPages = pdfDoc.numPages;
    const allPagesText = [];

    for (let i = 1; i <= numPages; i++) {
        const progress = (i / numPages) * 100;
        if (onStatusUpdate) onStatusUpdate({ status: 'progress', progress: progress });
        
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        
        // --- AQUI ESTAVA O PROBLEMA ---
        // Antes estava .join(' '), o que achatava o texto.
        // Agora usamos .join('\n') para preservar as linhas visuais do PDF.
        // Isso permite que a Regex ^SENTENÇA$ funcione.
        const pageString = textContent.items.map(item => item.str).join('\n');
        
        allPagesText.push(pageString);
    }

    const processMap = await mapAllProcessIdentifiers(allPagesText);
    if (processMap.length === 0) return processesToExtract;

    for (let i = 0; i < processMap.length; i++) {
        const currentProcess = processMap[i];
        const startPage = currentProcess.startPage;
        const endPage = (i + 1 < processMap.length) ? processMap[i + 1].startPage - 1 : numPages - 1;
        const finalEndPage = Math.max(startPage, endPage);
        
        // Junta as páginas mantendo as quebras de linha
        const sectionText = allPagesText.slice(startPage, finalEndPage + 1).join('\n');
        const normalizedSectionText = normalizeText(sectionText);

        for (const keyword of keywordsToSearch) {
            const normalizedKeyword = normalizeText(keyword);
            if (normalizedSectionText.includes(normalizedKeyword)) {
                let isValid = false;
                if (normalizedKeyword === 'suscitacao de duvida') {
                    // Agora sectionText tem as quebras de linha corretas para validar o título
                    isValid = validateSuscitacao(sectionText, currentProcess.number);
                } else if (normalizedKeyword === 'comarca de morrinhos') {
                    isValid = validateMorrinhos(sectionText, currentProcess.number);
                } else {
                    isValid = true;
                }
                if (isValid) {
                    processesToExtract.push({
                        processNumber: currentProcess.number,
                        startPage: startPage + 1,
                        endPage: finalEndPage + 1,
                        keyword: keyword
                    });
                }
            }
        }
    }
    return processesToExtract;
}

module.exports = { findAndValidateProcesses, normalizeText };
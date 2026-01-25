const fs = require('fs/promises');
const path = require('path');
const axios = require('axios');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chromium = require('chromium');
const { app } = require('electron');
const notifier = require('../telegramNotifier');

puppeteer.use(StealthPlugin());

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// --- UTILITÁRIOS ---

function safeFilename(s) { 
    return s.replace(/[^\w\s\-.]/gu, "").replace(/\s+/g, "_").trim().substring(0, 140) || "arquivo"; 
}

function extractIdent(url) {
    try {
        const urlObj = new URL(url);
        const match = urlObj.pathname.match(/\/(\d+)(?:\.\w+)?$/);
        return match ? match[1] : null;
    } catch (e) { return null; }
}

function generateDirectPdfUrls(docId) {
    if (!docId) return [];
    return [
        `https://tjdocs.tjgo.jus.br/documentos/${docId}.pdf`,
        `https://tjdocs.tjgo.jus.br/documentos/${docId}/pdf`,
        `https://tjdocs.tjgo.jus.br/pdf/${docId}`,
        `https://tjdocs.tjgo.jus.br/api/documentos/${docId}/download`
    ];
}

// --- FUNÇÕES DE DOWNLOAD ---

async function downloadBuffer(url, referer, cookies = []) {
    try {
        const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        const response = await axios.get(url, {
            responseType: 'arraybuffer', 
            timeout: 60000,
            maxRedirects: 5,
            headers: { 
                'User-Agent': UA, 
                'Accept': 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.8', 
                'Referer': referer, 
                'Cookie': cookieString 
            }
        });

        const buffer = Buffer.from(response.data);
        const cType = (response.headers['content-type'] || '').toLowerCase();
        
        const isPdfHeader = buffer.slice(0, 4).toString() === '%PDF';
        const isPdfMime = cType.includes('pdf') || cType.includes('octet-stream');

        if (response.status === 200 && (isPdfHeader || isPdfMime)) {
            return buffer;
        }
    } catch (e) { 
        // Silencioso
    }
    return null;
}

// --- LÓGICA DE ESTRATÉGIAS ---

async function processSingleLink(browser, linkData, downloadDir, index) {
    const prefix = String(index + 1).padStart(2, '0');
    const baseName = `${prefix}_${safeFilename(linkData.text)}`;
    const finalPath = path.join(downloadDir, `${baseName}.pdf`);
    const docId = extractIdent(linkData.href);

    console.log(`\n--- Processando [${index+1}]: ${linkData.text} (ID: ${docId || 'N/A'}) ---`);

    // INICIALIZAÇÃO DA PÁGINA (Movido para o topo pois a Estratégia 1 agora exige DOM)
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7" });
    
    let cdpBuffer = null;

    // Configura o interceptador de rede (CDP)
    await page.setRequestInterception(true);
    page.on('request', req => req.continue());
    
    page.on('response', async res => {
        try {
            const headers = res.headers();
            const cType = headers['content-type'] || '';
            if (cType.toLowerCase().includes('application/pdf') && Number(headers['content-length']) > 1000) {
                console.log(`[CDP] PDF Detectado na rede: ${res.url()}`);
                cdpBuffer = await res.buffer(); 
            }
        } catch (e) {}
    });

    try {
        // Navega para a página
        await page.goto(linkData.href, { waitUntil: 'networkidle2', timeout: 60000 });
        
        // =================================================================
        // ESTRATÉGIA 1 (NOVA ORDEM): Buscar no DOM (Prioridade Máxima)
        // =================================================================
        const domUrls = await page.evaluate(() => {
            const urls = new Set();
            const selectors = [
                'embed[type="application/pdf"]', 
                'object[type*="pdf"]', 
                'iframe[src*=".pdf"]', 
                'a[href*=".pdf"]', 
                'a[download]'
            ];
            
            selectors.forEach(sel => {
                document.querySelectorAll(sel).forEach(el => {
                    const src = el.src || el.href || el.data;
                    if (src) urls.add(src);
                });
            });
            return Array.from(urls);
        });

        if (domUrls.length > 0) {
            console.log(`[DOM] Encontradas ${domUrls.length} URLs candidatas.`);
            const cookies = await page.cookies();
            for (const url of domUrls) {
                const buffer = await downloadBuffer(url, page.url(), cookies);
                if (buffer) {
                    await fs.writeFile(finalPath, buffer);
                    console.log(`[Estratégia 1] Sucesso via DOM: ${url}`);
                    return true;
                }
            }
        }

        // =================================================================
        // ESTRATÉGIA 2: Verificar se a Rede pegou algo (Passivo)
        // =================================================================
        if (cdpBuffer) {
            await fs.writeFile(finalPath, cdpBuffer);
            console.log(`[Estratégia 2] Sucesso via Rede (Carregamento Automático)`);
            return true;
        }

        // =================================================================
        // ESTRATÉGIA 3: Tentativa Direta (Fallback)
        // =================================================================
        if (docId) {
            const candidates = generateDirectPdfUrls(docId);
            for (const url of candidates) {
                // Aqui usamos linkData.href como referer genérico
                const buffer = await downloadBuffer(url, linkData.href);
                if (buffer) {
                    await fs.writeFile(finalPath, buffer);
                    console.log(`[Estratégia 3] Sucesso via URL Direta: ${url}`);
                    return true;
                }
            }
        }

        // =================================================================
        // ESTRATÉGIA 4: Clicar no botão
        // =================================================================
        const clicked = await page.evaluate(() => {
            const buttons = document.querySelectorAll('a.btn.btn-primary, button.btn.btn-primary, a[download]');
            for (const btn of buttons) {
                if (btn.offsetParent !== null) { 
                    btn.click();
                    return true;
                }
            }
            return false;
        });

        if (clicked) {
            console.log("Botão clicado, aguardando resposta de rede...");
            const startTime = Date.now();
            while (Date.now() - startTime < 10000) {
                if (cdpBuffer) {
                    await fs.writeFile(finalPath, cdpBuffer);
                    console.log(`[Estratégia 4] Sucesso via Clique + Rede`);
                    return true;
                }
                await new Promise(r => setTimeout(r, 500));
            }
        }

    } catch (error) {
        console.error(`Erro na navegação de ${linkData.text}: ${error.message}`);
    } finally {
        if (!page.isClosed()) await page.close();
    }

    return false;
}

// --- FUNÇÃO PRINCIPAL EXPORTADA ---

async function downloadPdfs(downloadDir, onStatusUpdate) {
    await fs.mkdir(downloadDir, { recursive: true });

    let executablePath = chromium.path;
    if (app.isPackaged) {
        try {
            const unpackedDir = __dirname.replace('.asar', '.asar.unpacked').replace('services', '');
            executablePath = path.join(unpackedDir, 'node_modules', 'chromium', 'lib', 'chromium', 'chrome-win', 'chrome.exe');
        } catch (e) { console.error(e); }
    }

    console.log('Iniciando navegador...');
    const browser = await puppeteer.launch({ 
        headless: 'new', 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'], 
        executablePath: executablePath 
    });

    const page = await browser.newPage();
    await page.goto("https://www.tjgo.jus.br/index.php/processos/dj-eletronico", { waitUntil: 'networkidle2' });

    const sectionLinks = await page.evaluate((baseUrl) => {
        const xpathExpression = '//*[@id="tabelasDJ"]/table[1]//a | //*[@id="tabelasDJ"]/table[2]//a';
        const anchors = [];
        const query = document.evaluate(xpathExpression, document, null, 5, null);
        let node = query.iterateNext();
        while (node) { anchors.push(node); node = query.iterateNext(); }
        return anchors.map(a => ({
            text: (a.textContent || "").trim().replace(/\s+/g, ' '),
            href: new URL(a.getAttribute('href'), baseUrl).href
        })).filter(link => link.text.toLowerCase().includes('seção'));
    }, "https://www.tjgo.jus.br/index.php/processos/dj-eletronico");

    if (onStatusUpdate) onStatusUpdate({ status: 'download_start', totalLinks: sectionLinks.length });
    await notifier.sendMessage(`🚀 Iniciando pipeline (DOM Prioritário) para ${sectionLinks.length} arquivos.`);

    const failedLinks = [];

    for (const [index, link] of sectionLinks.entries()) {
        if (onStatusUpdate) onStatusUpdate({ status: 'download_progress', currentLinkNumber: index + 1, totalLinks: sectionLinks.length, progress: ((index + 1) / sectionLinks.length) * 100 });
        
        const success = await processSingleLink(browser, link, downloadDir, index);
        
        if (!success) {
            console.log(`[FALHA] Esgotadas todas as estratégias para: ${link.text}`);
            failedLinks.push(link.text);
        }
    }

    await browser.close();

    if (failedLinks.length > 0) {
        await notifier.sendMessage(`⚠️ Falha em ${failedLinks.length} arquivos:\n${failedLinks.join('\n')}`);
    } else {
        await notifier.sendMessage(`✅ Sucesso Absoluto! Todos os ${sectionLinks.length} arquivos baixados.`);
    }

    return await fs.readdir(downloadDir);
}

async function checkLatestDjeDate() {
    console.log('[CheckDate] Verificando data do DJE no site...');
    
    // Configuração mínima para ser rápido
    let executablePath = chromium.path;
    if (app.isPackaged) {
        try {
            const unpackedDir = __dirname.replace('.asar', '.asar.unpacked').replace('services', '');
            executablePath = path.join(unpackedDir, 'node_modules', 'chromium', 'lib', 'chromium', 'chrome-win', 'chrome.exe');
        } catch (e) { console.error(e); }
    }

    const browser = await puppeteer.launch({ 
        headless: 'new', 
        args: ['--no-sandbox', '--disable-setuid-sandbox'], 
        executablePath: executablePath 
    });

    try {
        const page = await browser.newPage();
        await page.goto("https://www.tjgo.jus.br/index.php/processos/dj-eletronico", { waitUntil: 'domcontentloaded', timeout: 30000 });

        // XPath fornecido por você: //*[@id="tabelasDJ"]/table[1]/thead/tr/th/strong
        const dateString = await page.evaluate(() => {
            const xpath = '//*[@id="tabelasDJ"]/table[1]/thead/tr/th/strong';
            const result = document.evaluate(xpath, document, null, 9, null);
            const node = result.singleNodeValue;
            return node ? node.innerText : null; // Ex: "Publicação de Hoje 14/01/2026 - DJE n. 4353"
        });

        await browser.close();

        if (dateString) {
            // Extrai apenas a data (dd/mm/aaaa) usando Regex
            const match = dateString.match(/(\d{2}\/\d{2}\/\d{4})/);
            if (match) {
                console.log(`[CheckDate] Data encontrada no site: ${match[1]}`);
                return match[1]; // Retorna "14/01/2026"
            }
        }
        return null;

    } catch (error) {
        console.error("Erro ao verificar data:", error);
        await browser.close();
        return null;
    }
}

module.exports = { downloadPdfs, checkLatestDjeDate };
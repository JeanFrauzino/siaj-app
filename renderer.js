// renderer.js (Versão Finalíssima: Robô + Segurança + WhatsApp Reload)

// --- CONFIGURAÇÃO ---
const ADMIN_PASSWORD = "admin"; // <--- SUA SENHA DE ADMINISTRADOR AQUI

// --- ELEMENTOS DA TELA PRINCIPAL ---
const startBtn = document.getElementById('start-btn');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const currentTaskLabel = document.getElementById('current-task');
const mainStatusText = document.getElementById('main-status-text');
const terminalContainer = document.getElementById('terminal-container');
const terminalBody = document.getElementById('terminal-body');
const resultsTitle = document.getElementById('results-title');
const resultsElement = document.getElementById('results');
const inputKeywords = document.getElementById('keywords');
const btnTestWhatsapp = document.getElementById('btn-test-whatsapp');
const inputLicenseKey = document.getElementById('license-key'); // <--- NOVO

// --- ELEMENTOS DE MODAL ---
const btnSettings = document.getElementById('settings-btn');
const modalSettings = document.getElementById('settings-modal');
const btnCloseSettings = document.getElementById('close-settings');

// --- ELEMENTOS DE SEGURANÇA (Senha) ---
const modalPassword = document.getElementById('password-modal');
const inputAdminPass = document.getElementById('admin-pass-input');
const btnPassConfirm = document.getElementById('btn-pass-confirm');
const btnPassCancel = document.getElementById('btn-pass-cancel');
const btnUnlockAdmin = document.getElementById('btn-unlock-admin');
const securityStatusText = document.getElementById('security-status-text');
const adminProtectedFields = document.querySelectorAll('.admin-protected');

// --- INPUTS DE CONFIGURAÇÃO ---
const btnSaveSettings = document.getElementById('save-settings-btn');
// Telegram
const inputToken = document.getElementById('telegram-token');
const inputChatId = document.getElementById('telegram-chat-id');
// Google IA
const inputGoogleApiKey = document.getElementById('google-api-key');
// Agendamento
const checkSchedule = document.getElementById('schedule-enabled');
const inputScheduleTime = document.getElementById('schedule-time');
const scheduleDaysCheckboxes = document.querySelectorAll('#schedule-days input[type="checkbox"]');
// Sistema
const inputRetention = document.getElementById('retention-days');
const checkSkipDownload = document.getElementById('skip-download');
const checkShowTerminal = document.getElementById('show-terminal');
// Email
const checkEmailEnabled = document.getElementById('email-enabled');
const inputEmailUser = document.getElementById('email-user');
const inputEmailPass = document.getElementById('email-pass');
const inputEmailDest = document.getElementById('email-dest');

// --- WHATSAPP (ELEMENTOS NOVOS) ---
const imgQrCode = document.getElementById('whatsapp-qr-code');
const badgeWhatsappStatus = document.getElementById('whatsapp-status-badge');
const checkWhatsappEnabled = document.getElementById('whatsapp-enabled');
const inputWhatsappNumber = document.getElementById('whatsapp-number');
const btnReloadQr = document.getElementById('btn-reload-qr'); // <--- NOVO BOTÃO

let isTerminalEnabled = true;

// --- FUNÇÃO AUXILIAR: LOG NO TERMINAL ---
function addLog(message, type = 'info') {
    if (!isTerminalEnabled) return; 
    const div = document.createElement('div');
    div.className = `log-line ${type}`;
    div.innerHTML = `<span style="opacity:0.5">[${new Date().toLocaleTimeString()}]</span> ${message}`;
    terminalBody.appendChild(div);
    terminalBody.scrollTop = terminalBody.scrollHeight;
}

// ========================================================
// 1. LÓGICA DE SEGURANÇA E MODAIS
// ========================================================

// Bloquear campos sensíveis
function lockAdminFields() {
    adminProtectedFields.forEach(field => field.disabled = true);
    btnUnlockAdmin.innerHTML = '<i class="fas fa-key"></i> Editar Avançado';
    btnUnlockAdmin.classList.remove('unlocked');
    securityStatusText.innerHTML = '<i class="fas fa-lock"></i> Modo Leitura (Seguro)';
}

// Desbloquear campos sensíveis
function unlockAdminFields() {
    adminProtectedFields.forEach(field => field.disabled = false);
    btnUnlockAdmin.innerHTML = '<i class="fas fa-unlock"></i> Desbloqueado';
    btnUnlockAdmin.classList.add('unlocked');
    securityStatusText.innerHTML = '<i class="fas fa-unlock-alt" style="color: #27ae60;"></i> Modo Edição (Admin)';
}

// Abrir Configurações (Sempre inicia bloqueado)
btnSettings.addEventListener('click', () => {
    modalSettings.style.display = 'flex';
    lockAdminFields(); 
});

// Fechar Configurações
btnCloseSettings.addEventListener('click', () => {
    modalSettings.style.display = 'none';
});

// Clicou em "Editar Avançado" -> Abre Modal de Senha
btnUnlockAdmin.addEventListener('click', () => {
    if (btnUnlockAdmin.classList.contains('unlocked')) return; // Já está livre
    modalPassword.style.display = 'flex';
    inputAdminPass.value = '';
    inputAdminPass.focus();
});

// Confirmar Senha
btnPassConfirm.addEventListener('click', () => {
    if (inputAdminPass.value === ADMIN_PASSWORD) {
        unlockAdminFields();
        modalPassword.style.display = 'none';
    } else {
        alert("Senha incorreta!");
        inputAdminPass.value = '';
        inputAdminPass.focus();
    }
});

// Cancelar Senha e Fechar Modais clicando fora
btnPassCancel.addEventListener('click', () => modalPassword.style.display = 'none');
inputAdminPass.addEventListener('keypress', (e) => { if (e.key === 'Enter') btnPassConfirm.click(); });

window.addEventListener('click', (e) => {
    if (e.target === modalSettings) modalSettings.style.display = 'none';
    if (e.target === modalPassword) modalPassword.style.display = 'none';
});

// ========================================================
// 2. COMUNICAÇÃO COM O ROBÔ (IPC)
// ========================================================

// Atualizações de Status (Barra de Progresso e Logs)
window.electronAPI.onUpdate((data) => {
    if (data.message) mainStatusText.textContent = data.message;
    
    switch(data.status) {
        case 'download_start':
            progressContainer.style.display = 'block';
            addLog(`Download iniciado. ${data.totalLinks} links.`, 'info');
            progressBar.value = 0;
            progressText.textContent = '0%';
            break;

        case 'download_progress':
            progressBar.value = data.progress;
            progressText.textContent = `${Math.round(data.progress)}%`;
            break;

        case 'analysis_start':
            addLog(`Analisando ${data.totalFiles} arquivos.`, 'info');
            break;

        case 'file_start':
            addLog(`> ${data.currentFileName}`, 'system');
            progressBar.value = 0;
            progressText.textContent = '0%';
            break;

        case 'progress':
            progressBar.value = data.progress;
            progressText.textContent = `${Math.round(data.progress)}%`;
            break;
    }
});

// --- LÓGICA DO WHATSAPP (QR CODE + RELOAD) ---
if (window.electronAPI.on) {
    // Recebe a imagem do QR Code
    window.electronAPI.on('whatsapp-qr', (url) => {
        if (imgQrCode) {
            imgQrCode.src = url;
            imgQrCode.style.display = 'block';
            badgeWhatsappStatus.textContent = "Escaneie o QR Code abaixo:";
            badgeWhatsappStatus.style.color = "#f1c40f"; // Amarelo
            
            // Se gerou QR, esconde o botão de reload (já está recarregado)
            if (btnReloadQr) btnReloadQr.style.display = 'none';
        }
    });

    // Recebe status (Conectado/Desconectado)
    window.electronAPI.on('whatsapp-status', (status) => {
        if (badgeWhatsappStatus) {
            badgeWhatsappStatus.textContent = status;
            
            if (status.includes('Conectado')) {
                // SUCESSO
                if (imgQrCode) imgQrCode.style.display = 'none';
                if (btnReloadQr) btnReloadQr.style.display = 'none'; // Esconde botão
                badgeWhatsappStatus.style.color = "#2ecc71"; // Verde
            } else {
                // DESCONECTADO
                if (imgQrCode) imgQrCode.style.display = 'none';
                if (btnReloadQr) btnReloadQr.style.display = 'inline-block'; // MOSTRA O BOTÃO!
                badgeWhatsappStatus.style.color = "#e74c3c"; // Vermelho
            }
        }
    });
}


window.electronAPI.on('app-lock-mode', () => {
    console.log("🔒 MODO DE BLOQUEIO ATIVADO");

    if (modalSettings) {
        // 1. Força o display FLEX para centralizar (resolve o problema de ficar no canto)
        modalSettings.style.display = 'flex';
        modalSettings.style.justifyContent = 'center';
        modalSettings.style.alignItems = 'center';
        
        // Garante que fique na frente de tudo
        modalSettings.style.zIndex = '9999'; 
        modalSettings.style.backgroundColor = 'rgba(0, 0, 0, 0.85)'; // Fundo bem escuro
    }

    // 2. Esconde o X mas mantém o espaço (visibility: hidden) para não quebrar o layout do cabeçalho
    if (btnCloseSettings) {
        btnCloseSettings.style.visibility = 'hidden'; 
    }

    // 3. Trava cliques fora
    window.onclick = null; 

    // 4. Desabilita botão de fundo
    if (startBtn) {
        startBtn.disabled = true;
        startBtn.innerText = "BLOQUEADO";
        startBtn.style.backgroundColor = "#555";
    }
});



// --- CLIQUE NO BOTÃO RECARREGAR QR CODE ---
if (btnReloadQr) {
    btnReloadQr.addEventListener('click', async () => {
        badgeWhatsappStatus.textContent = "Reiniciando serviço...";
        badgeWhatsappStatus.style.color = "#f1c40f"; 
        
        btnReloadQr.style.display = 'none'; // Evita duplo clique
        imgQrCode.style.display = 'none';
        
        // Chama o backend para reiniciar
        await window.electronAPI.restartWhatsapp();
    });
}


if (btnTestWhatsapp) {
    btnTestWhatsapp.addEventListener('click', async () => {
        const number = inputWhatsappNumber.value;

        if (!number) {
            alert("Por favor, digite um número de destino primeiro.");
            return;
        }

        // Feedback visual
        const originalText = btnTestWhatsapp.innerHTML;
        btnTestWhatsapp.disabled = true;
        btnTestWhatsapp.textContent = "Enviando...";

        try {
            const result = await window.electronAPI.sendWhatsappTest(number);
            
            if (result.success) {
                alert("✅ Mensagem enviada com sucesso! Verifique seu WhatsApp.");
            } else {
                alert("❌ Falha ao enviar. Verifique se o robô está conectado (QR Code) e se o número está correto.");
            }
        } catch (err) {
            alert("Erro: " + err);
        } finally {
            btnTestWhatsapp.disabled = false;
            btnTestWhatsapp.innerHTML = originalText;
        }
    });
}


// Botão Iniciar Processo
startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    startBtn.textContent = 'Executando...';
    mainStatusText.textContent = "Rodando...";
    progressContainer.style.display = 'block';
    
    // Auto-salvar Keywords antes de rodar
    const currentKeywords = inputKeywords.value.split('\n').map(k => k.trim()).filter(k => k.length > 0);
    const tempSettings = await window.electronAPI.getSettings() || {};
    tempSettings.keywords = currentKeywords;
    await window.electronAPI.saveSettings(tempSettings);

    if (isTerminalEnabled) terminalBody.innerHTML = '<div class="log-line system">--- Nova Execução ---</div>';
    resultsElement.innerHTML = ''; resultsTitle.textContent = '';
    
    try {
        const result = await window.electronAPI.startProcess();
        addLog(`Finalizado. ${result.totalExtractions} processos.`, 'success');
        mainStatusText.textContent = "Concluído";
        
        if (result && result.extractedFiles.length > 0) {
            resultsTitle.textContent = `Encontrados: ${result.totalExtractions}`;
            result.extractedFiles.forEach(f => {
                const li = document.createElement('li');
                li.textContent = f;
                resultsElement.appendChild(li);
            });
        }
    } catch (error) {
        addLog(`Erro: ${error.message}`, 'error');
        mainStatusText.textContent = "Erro";
    } finally {
        startBtn.disabled = false;
        startBtn.textContent = 'Iniciar Download e Análise';
    }
});

// ========================================================
// 3. CARREGAR E SALVAR CONFIGURAÇÕES
// ========================================================

function parseCronDays(daysString) {
    const finalDays = new Set();
    if (!daysString || daysString === '*') { for (let i = 0; i <= 6; i++) finalDays.add(String(i)); return finalDays; }
    const parts = daysString.split(',');
    parts.forEach(part => {
        if (part.includes('-')) {
            const [start, end] = part.split('-').map(Number);
            for (let i = start; i <= end; i++) finalDays.add(String(i));
        } else finalDays.add(part);
    });
    return finalDays;
}

// Carregar ao abrir
document.addEventListener('DOMContentLoaded', async () => {
    const settings = await window.electronAPI.getSettings();
    if (settings) {
        // Principal
        inputKeywords.value = (settings.keywords || []).join('\n');
        
        // Telegram / Google / Sistema
        // Onde você preenche os campos com 'settings.telegramToken', etc...
if (inputLicenseKey) inputLicenseKey.value = settings.licenseKey || ''; // <--- NOVO
        inputToken.value = settings.telegramToken || '';
        inputChatId.value = settings.telegramChatId || '';
        inputGoogleApiKey.value = settings.googleApiKey || ''; 
        inputRetention.value = settings.retentionDays || 7;
        checkSkipDownload.checked = settings.skipDownload || false;
        
        // Terminal
        isTerminalEnabled = (settings.showTerminal !== false);
        checkShowTerminal.checked = isTerminalEnabled;
        terminalContainer.style.display = isTerminalEnabled ? 'block' : 'none';

        // Email
        checkEmailEnabled.checked = settings.emailEnabled || false;
        inputEmailUser.value = settings.emailUser || '';
        inputEmailPass.value = settings.emailPass || '';
        inputEmailDest.value = settings.emailDest || '';

        // WhatsApp
        if (checkWhatsappEnabled) checkWhatsappEnabled.checked = settings.whatsappEnabled || false;
        if (inputWhatsappNumber) inputWhatsappNumber.value = settings.whatsappNumber || '';

        // Agendamento
        checkSchedule.checked = settings.scheduleEnabled || false;
        const cronString = settings.scheduleCron || '0 8 * * 1-5'; 
        try {
            const parts = cronString.split(' ');
            inputScheduleTime.value = `${parts[1].padStart(2,'0')}:${parts[0].padStart(2,'0')}`;
            scheduleDaysCheckboxes.forEach(cb => cb.checked = false);
            const finalDays = parseCronDays(parts[4]);
            scheduleDaysCheckboxes.forEach(cb => { if (finalDays.has(cb.value)) cb.checked = true; });
        } catch (e) { inputScheduleTime.value = '08:00'; }
    } else {
        terminalContainer.style.display = 'block'; 
    }

    try {
        // Vamos criar uma função rápida no preload/main pra pegar o ID se não tiver
        // Ou podemos usar o licenseService retornando erro que já traz o ID no 'detail'.
        // Mas o jeito mais limpo é expor no preload.
        const hwid = await window.electronAPI.getMachineId(); // Faremos essa ponte agora
        const display = document.getElementById('machine-id-display');
        if (display) display.textContent = hwid;
        
        // Botão de copiar
        const btnCopy = document.getElementById('btn-copy-id');
        if (btnCopy) {
            btnCopy.addEventListener('click', (e) => {
                e.preventDefault();
                navigator.clipboard.writeText(hwid);
                btnCopy.textContent = "(Copiado!)";
                setTimeout(() => btnCopy.textContent = "(Copiar)", 2000);
            });
        }
    } catch (e) { console.error("Erro ao pegar HWID", e); }




});

// Toggle Terminal
checkShowTerminal.addEventListener('change', (e) => {
    isTerminalEnabled = e.target.checked;
    terminalContainer.style.display = isTerminalEnabled ? 'block' : 'none';
});

// Salvar Configurações
btnSaveSettings.addEventListener('click', async () => {

    if (inputLicenseKey && inputLicenseKey.value.trim() === "") {
        alert("⚠️ O campo 'Chave de Licença' é obrigatório para utilizar o sistema.");
        
        // Foca no campo e pinta de vermelho
        inputLicenseKey.focus();
        inputLicenseKey.style.border = "2px solid red";
        
        // O IMPORTANTE: O 'return' para tudo aqui. Não salva, não reinicia.
        return; 
    } else {
        // Se preencheu, remove o vermelho (caso tivesse erro antes)
        if (inputLicenseKey) inputLicenseKey.style.border = "";
    }



    const keywords = inputKeywords.value.split('\n').map(k => k.trim()).filter(k => k.length > 0);
    
    // Cron Logic
    let scheduleCron = '0 0 * * *';
    const timeValue = inputScheduleTime.value;
    if (timeValue) { 
        const [hour, minute] = timeValue.split(':');
        const daysOfWeek = [];
        scheduleDaysCheckboxes.forEach(cb => { if (cb.checked) daysOfWeek.push(cb.value); });
        const daysString = daysOfWeek.length > 0 ? daysOfWeek.join(',') : '*';
        scheduleCron = `${parseInt(minute)} ${parseInt(hour)} * * ${daysString}`;
    }

    const settings = {
        // Tokens e Chaves
        telegramToken: inputToken.value.trim(),
        telegramChatId: inputChatId.value.trim(),
        googleApiKey: inputGoogleApiKey.value.trim(),

        licenseKey: inputLicenseKey ? inputLicenseKey.value.trim() : '',
        
        // Agendamento
        scheduleCron: scheduleCron, 
        scheduleEnabled: checkSchedule.checked,
        
        // Sistema
        retentionDays: parseInt(inputRetention.value, 10) || 0,
        skipDownload: checkSkipDownload.checked,
        showTerminal: checkShowTerminal.checked,
        
        // Email
        emailEnabled: checkEmailEnabled.checked,
        emailUser: inputEmailUser.value.trim(),
        emailPass: inputEmailPass.value.trim(),
        emailDest: inputEmailDest.value.trim(),
        
        // WhatsApp
        whatsappEnabled: checkWhatsappEnabled ? checkWhatsappEnabled.checked : false,
        whatsappNumber: inputWhatsappNumber ? inputWhatsappNumber.value.trim() : '',

        // Principal
        keywords: keywords 
    };

    const result = await window.electronAPI.saveSettings(settings);

    if (result.success) {
        // Verifica se estava bloqueado (se o botão Start estiver desativado/bloqueado)
        const wasLocked = startBtn.disabled && startBtn.innerText === "BLOQUEADO";

        if (wasLocked) {
            // Se estava bloqueado, OBRIGA o reinício
            const resp = confirm("Licença salva com sucesso!\n\nO sistema precisa ser reiniciado para validar a nova chave.\nDeseja reiniciar agora?");
            if (resp) {
                window.electronAPI.restartApp(); // Chama o reinício total
            }
        } else {
            // Fluxo normal (usuário trocou configuração durante o uso)
            alert('Configurações salvas com sucesso!');
            location.reload(); // Reload simples serve aqui
        }
        
        modalSettings.style.display = 'none';
    } else {
        alert('Erro ao salvar configurações.');
    }
});
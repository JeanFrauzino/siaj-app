// services/licenseService.js (Versão Criptografada)
const { machineIdSync } = require('node-machine-id');
const Store = require('electron-store');
const { dialog } = require('electron');
const crypto = require('crypto');

const store = new Store();

// --- MESMA CHAVE DO GERADOR ---
const SECRET_KEY = 'SIAJ_GO_2026_SEGURANCA_MAXIMA_KEY_V1'; 
const ALGORITHM = 'aes-256-cbc';

function descriptografar(text) {
    try {
        const parts = text.split(':');
        if (parts.length !== 2) return null;

        const iv = Buffer.from(parts[0], 'hex');
        const encryptedText = Buffer.from(parts[1], 'hex');
        
        // Gera a chave de 32 bytes a partir da senha
        const key = crypto.createHash('sha256').update(String(SECRET_KEY)).digest('base64').substr(0, 32);

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);

        return JSON.parse(decrypted.toString());
    } catch (e) {
        console.error("Erro ao descriptografar:", e.message);
        return null; // Chave inválida ou corrompida
    }
}

module.exports = {
    async validate() {
        console.log("--- CHECAGEM DE LICENÇA (CRYPTO) ---");
        
        const savedData = store.get('userSettings'); 
        const licenseKey = savedData ? savedData.licenseKey : null;
        
        // Pega o ID da máquina atual
        const currentHwid = machineIdSync();

        // FUNÇÃO DE REJEIÇÃO (Para não repetir código)
        const reject = (msg, detail) => {
            const btn = dialog.showMessageBoxSync({
                type: 'error',
                title: 'Licença Inválida',
                message: msg,
                detail: `${detail}\n\nSEU ID DE MÁQUINA (HWID): ${currentHwid}`,
                buttons: ['Sair', 'Inserir Nova Licença'],
                defaultId: 1,
                cancelId: 0,
                noLink: true
            });
            return btn === 0 ? { status: 'EXIT' } : { status: 'LOCK_SCREEN' };
        };

        // 1. Verifica se existe texto
        if (!licenseKey || licenseKey.trim() === "") {
            return reject("Licença não encontrada.", "Por favor, insira uma chave válida nas configurações.");
        }

        // 2. Tenta Descriptografar
        const dadosLicenca = descriptografar(licenseKey.trim());

        if (!dadosLicenca) {
            return reject("Chave de Licença Inválida.", "O código inserido não é autêntico ou está corrompido.");
        }

        console.log("Licença Aberta:", dadosLicenca);

        // 3. Valida Data de Expiração
        const hoje = new Date();
        const validade = new Date(dadosLicenca.validade);
        // Ajuste de fuso horário simples (zera as horas para comparar apenas dia)
        hoje.setHours(0,0,0,0);
        validade.setHours(0,0,0,0); // Ajuste conforme necessidade, mas data ISO costuma ser UTC

        if (hoje > validade) {
            return reject("Licença Expirada.", `Sua assinatura venceu em: ${dadosLicenca.validade}`);
        }

        // 4. Valida Hardware (Opcional - Se o gerador vier com HWID preenchido)
        if (dadosLicenca.hwid && dadosLicenca.hwid !== currentHwid) {
            return reject("Violação de Hardware.", "Esta licença pertence a outra máquina.");
        }

        // SUCESSO!
        return { status: 'VALID', data: dadosLicenca }; 
    }
};
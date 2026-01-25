// services/emailService.js

const nodemailer = require('nodemailer');
const path = require('path');

/**
 * Envia um único e-mail com todos os processos encontrados no ciclo.
 * @param {Object} settings - Configurações do usuário
 * @param {Array} batchData - Lista de objetos { processData, aiReport, pdfPath }
 */
async function sendBatchReport(settings, batchData) {
    // Validação básica
    if (!settings.emailUser || !settings.emailPass || !settings.emailDest) {
        console.warn("[Email] Credenciais não configuradas. Pulando envio.");
        return;
    }

    if (!batchData || batchData.length === 0) return;

    try {
        // --- DETECÇÃO AUTOMÁTICA DE SERVIÇO ---
        const emailLower = settings.emailUser.toLowerCase();
        let serviceName = 'hotmail'; // Padrão
        if (emailLower.includes('gmail.com')) serviceName = 'gmail';
        // ---------------------------------------

        const transporter = nodemailer.createTransport({
            service: serviceName,
            auth: {
                user: settings.emailUser,
                pass: settings.emailPass
            }
        });

        const dataEnvio = new Date().toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' });
        const totalProcessos = batchData.length;
        
        // Assunto do E-mail (Resumo)
        const subject = `[SIAJ-GO] Resumo: ${totalProcessos} novos processos encontrados`;

        // --- CONSTRUÇÃO DOS ANEXOS ---
        // Cria um array com todos os caminhos de PDF
        const attachments = batchData.map(item => ({
            filename: path.basename(item.pdfPath),
            path: item.pdfPath
        }));

        // --- CONSTRUÇÃO DO HTML (LOOP) ---
        // Vamos gerar o HTML de cada processo dinamicamente
        let processosHtml = '';
        
        batchData.forEach((item, index) => {
            processosHtml += `
                <div style="margin-bottom: 30px; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
                    <div style="background-color: #f1f2f6; padding: 10px 15px; border-bottom: 1px solid #e0e0e0; font-weight: bold; color: #2c3e50;">
                        #${index + 1} - Processo: ${item.processData.processNumber}
                    </div>
                    <div style="padding: 15px;">
                        <p style="margin: 5px 0;"><strong>🔑 Palavra-chave:</strong> ${item.processData.keyword}</p>
                        <p style="margin: 5px 0;"><strong>⚖️ Resultado IA:</strong> ${item.aiReport.resultado || 'N/A'}</p>
                        
                        <div style="background-color: #fff8e1; padding: 10px; border-radius: 5px; margin-top: 10px; border-left: 4px solid #f1c40f; font-size: 0.95rem;">
                            <strong>Resumo:</strong><br>
                            ${item.aiReport.resumoDoCaso || 'Sem resumo.'}
                        </div>
                    </div>
                </div>
            `;
        });

        // HTML FINAL
        const htmlBody = `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #333; line-height: 1.6; max-width: 700px;">
                
                <h2 style="color: #2c3e50; border-bottom: 2px solid #667eea; padding-bottom: 10px;">
                    🤖 Relatório de Execução
                </h2>
                
                <p>Olá,</p>
                <p>O <strong>SIAJ-GO</strong> finalizou a varredura e encontrou <strong>${totalProcessos} processos</strong> relevantes.</p>
                <p>Abaixo estão os detalhes de cada ocorrência. Os arquivos PDF originais seguem em anexo.</p>
                
                <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">

                ${processosHtml}

                <br>
                <div style="margin-top: 30px; border-top: 1px solid #bdc3c7; padding-top: 15px; font-size: 12px; color: #7f8c8d;">
                    <p style="margin: 0; font-weight: bold; color: #2c3e50; font-size: 14px;">
                        SIAJ-GO
                    </p>
                    <p style="margin: 0;">Sistema de Inteligência e Automação Jurídica</p>
                    <p style="margin-top: 5px;">📅 Gerado em: ${dataEnvio}</p>
                </div>
            </div>
        `;

        const info = await transporter.sendMail({
            from: `"Robô SIAJ-GO" <${settings.emailUser}>`,
            to: settings.emailDest,
            subject: subject,
            html: htmlBody,
            attachments: attachments
        });

        console.log(`[Email] Batch enviado com ${totalProcessos} processos. ID: ${info.messageId}`);
        return true;

    } catch (error) {
        console.error("[Email] Erro ao enviar batch:", error);
        // Não jogamos erro para não parar o robô, apenas logamos
    }
}

module.exports = { sendBatchReport };
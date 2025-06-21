require('dotenv').config();

const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();

// 📦 Inicializa banco SQLite
const db = new sqlite3.Database('banco.db', (err) => {
    if (err) {
        console.error('❌ Erro ao conectar ao SQLite:', err.message);
    } else {
        console.log('🗄️ Banco conectado com sucesso');
    }
});

// 🚀 Inicializa Express (caso queira expor endpoints depois)
const app = express();
app.use(express.json());

// 🤖 Inicializa o bot do Telegram
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID || '-1002733614113';

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

console.log('🤖 Bot Telegram rodando...');

// ✅ Função para salvar venda corretamente
function salvarVenda(venda) {
    const sql = `
        INSERT INTO vendas (
            chave, hash, valor, utm_source, utm_medium,
            utm_campaign, utm_content, utm_term,
            orderId, transaction_id, ip, userAgent
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const valores = [
        venda.chave,
        venda.hash,
        venda.valor,
        venda.utm_source,
        venda.utm_medium,
        venda.utm_campaign,
        venda.utm_content,
        venda.utm_term,
        venda.orderId,
        venda.transaction_id,
        venda.ip,
        venda.userAgent
    ];

    db.run(sql, valores, function (err) {
        if (err) {
            console.error('❌ Erro ao salvar venda:', err.message);
        } else {
            console.log('✅ Venda salva no SQLite com ID:', this.lastID);
        }
    });
}

// 🗝️ Exemplo de funções utilitárias (simulação, ajuste conforme seu código real)
function gerarChaveUnica({ transaction_id }) {
    return `chave-${transaction_id}`;
}

function gerarHash({ transaction_id }) {
    return `hash-${transaction_id}`;
}

async function vendaExiste(hash) {
    return new Promise((resolve, reject) => {
        const sql = 'SELECT COUNT(*) AS total FROM vendas WHERE hash = ?';
        db.get(sql, [hash], (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row.total > 0);
            }
        });
    });
}

// 📥 Escuta mensagens do Telegram
bot.on('message', async (msg) => {
    if (msg.chat.id.toString() !== CHAT_ID) return;

    const texto = msg.text || '';

    try {
        // Regex para pegar ID Gateway e Valor Líquido
        const idRegex = /ID Transação Gateway:\s*([^\n]+)/i;
        const valorRegex = /Valor Líquido:\s*R\$([\d,.]+)/i;

        const idMatch = texto.match(idRegex);
        const valorMatch = texto.match(valorRegex);

        if (!idMatch || !valorMatch) {
            console.log('⚠️ Mensagem não contém dados de venda.');
            return;
        }

        const transaction_id = idMatch[1].trim();
        const valorNum = parseFloat(valorMatch[1].replace(',', '.').trim());

        // Cria chave e hash
        const chave = gerarChaveUnica({ transaction_id });
        const hash = gerarHash({ transaction_id });

        const jaExiste = await vendaExiste(hash);
        if (jaExiste) {
            console.log('🔁 Venda já existe no banco.');
            return;
        }

        const orderId = 'pedido-' + Date.now();
        const agora = new Date().toISOString().replace('T', ' ').substring(0, 19);

        // Monta payload UTMify
        const payload = {
            orderId,
            platform: 'PushinPay',
            paymentMethod: 'pix',
            status: 'paid',
            createdAt: agora,
            approvedDate: agora,
            refundedAt: null,
            customer: {
                name: "ClienteVIP",
                email: "cliente@email.com",
                phone: null,
                document: null,
                country: 'BR'
            },
            products: [
                {
                    id: 'produto-1',
                    name: 'Acesso VIP',
                    planId: 'vip-acesso',
                    planName: 'Acesso VIP Mensal',
                    quantity: 1,
                    priceInCents: Math.round(valorNum * 100)
                }
            ],
            trackingParameters: {},
            commission: {
                totalPriceInCents: Math.round(valorNum * 100),
                gatewayFeeInCents: 0,
                userCommissionInCents: Math.round(valorNum * 100)
            },
            isTest: false
        };

        // 🔗 Envia pedido para UTMify
        const response = await axios.post('https://api.utmify.com.br/api-credentials/orders', payload, {
            headers: {
                'x-api-token': process.env.API_KEY,
                'Content-Type': 'application/json'
            }
        });

        // 💾 Salva venda no banco local
        salvarVenda({
            chave,
            hash,
            valor: valorNum,
            utm_source: null,
            utm_medium: null,
            utm_campaign: null,
            utm_content: null,
            utm_term: null,
            orderId,
            transaction_id,
            ip: 'bot',
            userAgent: 'telegram-bot'
        });

        console.log('✅ Pedido criado na UTMify:', response.data);

    } catch (err) {
        console.error('❌ Erro ao processar mensagem do bot:', err.message);
    }
});

// 🚀 Se quiser subir o Express junto:
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
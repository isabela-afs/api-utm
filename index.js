require('dotenv').config();

const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const moment = require('moment');

// 📦 Inicializa banco SQLite
const db = new sqlite3.Database('banco.db', (err) => {
    if (err) {
        console.error('❌ Erro ao conectar ao SQLite:', err.message);
    } else {
        console.log('🗄️ Banco conectado com sucesso');
    }
});

// 🚀 Inicializa Express (para expor webhook e outros endpoints)
const app = express();
app.use(express.json());

// 🤖 Inicializa o bot do Telegram SEM polling, para usar webhook
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID || '-1002733614113';

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

// Configura endpoint para webhook do Telegram
app.post(`/bot${TELEGRAM_BOT_TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Define o webhook para o Telegram
bot.setWebHook(`${process.env.WEBHOOK_URL}/bot${TELEGRAM_BOT_TOKEN}`)
    .then(() => console.log('Webhook configurado com sucesso'))
    .catch(err => console.error('Erro ao configurar webhook:', err));

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

// 🗝️ Funções utilitárias
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

        const chave = gerarChaveUnica({ transaction_id });
        const hash = gerarHash({ transaction_id });

        const jaExiste = await vendaExiste(hash);
        if (jaExiste) {
            console.log('🔁 Venda já existe no banco.');
            return;
        }

        const orderId = 'pedido-' + Date.now();

        // Datas em UTC formato "YYYY-MM-DD HH:mm:ss"
        const agoraUtc = moment.utc().format('YYYY-MM-DD HH:mm:ss');

        // Exemplo de trackingParameters — ajustar conforme dados reais se tiver
        const trackingParameters = {
            src: null,
            sck: null,
            utm_source: null,
            utm_campaign: null,
            utm_medium: null,
            utm_content: null,
            utm_term: null
        };

        // Comissão exemplo: sem taxa de gateway, full valor para vendedor
        const commission = {
            totalPriceInCents: Math.round(valorNum * 100),
            gatewayFeeInCents: 0,
            userCommissionInCents: Math.round(valorNum * 100),
        };

        // Payload UTMify para Pix pago
        const payload = {
            orderId,
            platform: 'PushinPay',
            paymentMethod: 'pix',
            status: 'paid',
            createdAt: agoraUtc,
            approvedDate: agoraUtc,
            refundedAt: null,
            customer: {
                name: "ClienteVIP",
                email: "cliente@email.com",
                phone: null,
                document: null,
                country: 'BR',
                ip: 'bot'
            },
            products: [
                {
                    id: 'produto-1',
                    name: 'Acesso VIP',
                    planId: null,
                    planName: null,
                    quantity: 1,
                    priceInCents: Math.round(valorNum * 100)
                }
            ],
            trackingParameters,
            commission,
            isTest: false
        };

        const response = await axios.post('https://api.utmify.com.br/api-credentials/orders', payload, {
            headers: {
                'x-api-token': process.env.API_KEY,
                'Content-Type': 'application/json'
            }
        });

        salvarVenda({
            chave,
            hash,
            valor: valorNum,
            utm_source: trackingParameters.utm_source,
            utm_medium: trackingParameters.utm_medium,
            utm_campaign: trackingParameters.utm_campaign,
            utm_content: trackingParameters.utm_content,
            utm_term: trackingParameters.utm_term,
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

// 🚀 Sobe o servidor Express na porta 3000 ou variável PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});

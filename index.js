const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const input = require('input');
const moment = require('moment');
const axios = require('axios');
const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();
const cors = require('cors');

const app = express();

const corsOptions = {
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    optionsSuccessStatus: 204
};
app.use(cors(corsOptions));

app.use(express.json());

// --- SUAS CONFIGURAÇÕES ---
const apiId = 23313993; 
const apiHash = 'd9249aed345807c04562fb52448a878c'; 
const stringSession = new StringSession(process.env.TELEGRAM_SESSION || ''); // Preencha com sua String Session se não usar .env
const CHAT_ID = BigInt(-1002733614113); 
const PORT = process.env.PORT || 3000; 

// --- CONFIGURAÇÃO DO BANCO DE DADOS POSTGRESQL ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

pool.on('connect', () => {
    console.log('✅ PostgreSQL conectado!');
});

pool.on('error', (err) => {
    console.error('❌ Erro inesperado no pool do PostgreSQL:', err);
    process.exit(-1);
});

// --- FUNÇÃO PARA INICIALIZAR TABELAS NO POSTGRESQL ---
async function setupDatabase() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS vendas (
                id SERIAL PRIMARY KEY,
                chave TEXT UNIQUE NOT NULL,
                hash TEXT UNIQUE NOT NULL,
                valor REAL NOT NULL,
                utm_source TEXT,
                utm_medium TEXT,
                utm_campaign TEXT,
                utm_content TEXT,
                utm_term TEXT,
                order_id TEXT,
                transaction_id TEXT,
                ip TEXT,
                user_agent TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Tabela "vendas" verificada/criada no PostgreSQL.');

        await client.query(`
            CREATE TABLE IF NOT EXISTS frontend_utms (
                id SERIAL PRIMARY KEY,
                unique_click_id TEXT UNIQUE NOT NULL, 
                timestamp_ms BIGINT NOT NULL,
                valor REAL, 
                fbclid TEXT, 
                utm_source TEXT,
                utm_medium TEXT,
                utm_campaign TEXT,
                utm_content TEXT,
                utm_term TEXT,
                ip TEXT,
                received_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Tabela "frontend_utms" verificada/criada no PostgreSQL.');

        await client.query(`
            CREATE TABLE IF NOT EXISTS telegram_users (
                telegram_user_id TEXT PRIMARY KEY,
                unique_click_id TEXT, 
                last_activity TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Tabela "telegram_users" verificada/criada no PostgreSQL.');
    } catch (err) {
        console.error('❌ Erro ao configurar tabelas no PostgreSQL:', err.message);
        process.exit(1);
    } finally {
        client.release();
    }
}

// --- FUNÇÕES DE UTILIDADE PARA O BANCO DE DADOS ---

function gerarChaveUnica({ transaction_id }) {
    return `chave-${transaction_id}`;
}

function gerarHash({ transaction_id }) {
    return `hash-${transaction_id}`;
}

// ✅ FUNÇÃO CORRIGIDA: Salva a venda e retorna true se for nova, false se for duplicada.
async function salvarVenda(venda) {
    console.log('💾 Tentando registrar a venda no banco (PostgreSQL)...');
    const sql = `
        INSERT INTO vendas (
            chave, hash, valor, utm_source, utm_medium,
            utm_campaign, utm_content, utm_term,
            order_id, transaction_id, ip, user_agent
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (hash) DO NOTHING;
    `;
    const valores = [
        venda.chave, venda.hash, venda.valor,
        venda.utm_source, venda.utm_medium, venda.utm_campaign,
        venda.utm_content, venda.utm_term, venda.orderId,
        venda.transaction_id, venda.ip, venda.userAgent
    ];

    try {
        const res = await pool.query(sql, valores);
        if (res.rowCount > 0) {
            console.log('✅ Venda nova registrada com sucesso no PostgreSQL!');
            return true;
        } else {
            console.log('🔁 Venda já existia no banco (hash duplicado). Nenhuma ação tomada.');
            return false;
        }
    } catch (err) {
        console.error('❌ Erro crítico ao salvar venda no DB (PostgreSQL):', err.message);
        return false;
    }
}

// As outras funções de banco de dados permanecem as mesmas...
async function saveUserClickAssociation(telegramUserId, uniqueClickId) { /* ...código original... */ }
async function getUniqueClickIdForUser(telegramUserId) { /* ...código original... */ }
async function salvarFrontendUtms(data) { /* ...código original... */ }
async function buscarUtmsPorUniqueClickId(uniqueClickId) { /* ...código original... */ }
async function buscarUtmsPorTempoEValor(targetTimestamp, targetIp = null, windowMs = 120000) { /* ...código original... */ }

async function limparFrontendUtmsAntigos() {
    console.log('🧹 Iniciando limpeza de UTMs antigos do frontend...');
    const cutoffTime = moment().subtract(24, 'hours').valueOf();
    const sql = `DELETE FROM frontend_utms WHERE timestamp_ms < $1`;
    try {
        const res = await pool.query(sql, [cutoffTime]);
        console.log(`🧹 Limpeza de UTMs antigos do frontend: ${res.rowCount || 0} registros removidos.`);
    } catch (err) {
        console.error('❌ Erro ao limpar UTMs antigos do frontend:', err.message);
    }
}

// --- ENDPOINTS HTTP ---
app.post('/frontend-utm-data', (req, res) => { /* ...código original... */ });
app.get('/ping', (req, res) => { res.status(200).send('Pong!'); });

// --- INICIALIZAÇÃO DO SERVIÇO ---
app.listen(PORT, () => {
    console.log(`🌐 Servidor HTTP Express escutando na porta ${PORT}.`);
    
    // Auto-ping para manter o serviço ativo
    setInterval(() => {
        axios.get(`http://localhost:${PORT}/ping`).catch(err => console.error(`💔 Erro no auto-ping: ${err.message}`));
    }, 20 * 1000);

    (async () => {
        await setupDatabase();
        limparFrontendUtmsAntigos();
        setInterval(limparFrontendUtmsAntigos, 60 * 60 * 1000);

        console.log('Iniciando userbot...');
        const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });

        try {
            await client.start({
                phoneNumber: async () => await input.text('Digite seu número com DDI (ex: +5511987654321): '),
                password: async () => await input.text('Senha 2FA (se tiver): '),
                phoneCode: async () => await input.text('Código do Telegram: '),
                onError: (err) => console.log('Erro durante o login/start do cliente:', err),
            });
            console.log('✅ Userbot conectado!');
            console.log('🔑 Nova StringSession (se precisar):', client.session.save());
        } catch (error) {
            console.error('❌ Falha ao iniciar o userbot:', error.message);
            process.exit(1);
        }

        // --- MANIPULADOR DE MENSAGENS (LÓGICA PRINCIPAL CORRIGIDA) ---
        client.addEventHandler(async (event) => {
            const message = event.message;
            if (!message || !message.message || (await message.getChatId())?.toString() !== CHAT_ID.toString()) {
                return;
            }

            const texto = String(message.message).trim();

            if (texto.startsWith('/start ')) {
                // ... lógica do /start ...
                return;
            }

            try {
                // --- Regex mais precisas e corrigidas ---
                const idRegex = /ID Transa(?:ç|c)[aã]o Gateway[:：]?\s*([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i;
                const valorLiquidoRegex = /Valor L[ií]quido[:：]?\s*R?\$?\s*([\d.,]+)/i;
                const idInternaRegex = /ID Transa(?:ç|c)[aã]o Interna[:：]?\s*(\w+)/i;
                const nomeCompletoRegex = /Nome Completo[:：]?\s*(.+)/i;
                const emailRegex = /E-mail[:：]?\s*(\S+@\S+\.\S+)/i;
                const metodoPagamentoRegex = /M[ée]todo Pagamento[:：]?\s*(.+)/i;
                const plataformaPagamentoRegex = /Plataforma Pagamento[:：]?\s*(.+)/i;
                
                const idMatch = texto.match(idRegex);
                const valorLiquidoMatch = texto.match(valorLiquidoRegex);

                if (!idMatch || !valorLiquidoMatch) {
                    console.log('⚠️ Mensagem não contém ID da Transação Gateway ou Valor Líquido. Ignorando.');
                    return;
                }

                const transaction_id = idMatch[1].trim();
                const valorLiquidoNum = parseFloat(valorLiquidoMatch[1].replace(/\./g, '').replace(',', '.').trim());
                const chave = gerarChaveUnica({ transaction_id });
                const hash = gerarHash({ transaction_id });

                // --- Busca de UTMs corrigida ---
                let utmsEncontradas = { utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null };
                let ipClienteFrontend = 'telegram';
                const idInternaMatch = texto.match(idInternaRegex);
                if (idInternaMatch) {
                    const idInterno = idInternaMatch[1].trim();
                    console.log(`🔎 Buscando UTMs pelo ID Interno: ${idInterno}`);
                    const matchedFrontendUtms = await buscarUtmsPorUniqueClickId(idInterno);
                    if (matchedFrontendUtms) {
                        utmsEncontradas = {
                            utm_source: matchedFrontendUtms.utm_source,
                            utm_medium: matchedFrontendUtms.utm_medium,
                            utm_campaign: matchedFrontendUtms.utm_campaign,
                            utm_content: matchedFrontendUtms.utm_content,
                            utm_term: matchedFrontendUtms.utm_term,
                        };
                        ipClienteFrontend = matchedFrontendUtms.ip || 'frontend_matched';
                        console.log(`✅ UTMs encontradas para o ID Interno ${idInterno}.`);
                    } else {
                        console.log(`⚠️ Nenhuma UTM encontrada para o ID Interno ${idInterno}.`);
                    }
                }

                // --- LÓGICA ANTI-DUPLICAÇÃO ---
                const vendaParaSalvar = {
                    chave, hash, valor: valorLiquidoNum, ...utmsEncontradas,
                    orderId: transaction_id, transaction_id,
                    ip: ipClienteFrontend, userAgent: 'userbot'
                };

                // 1. TENTA SALVAR PRIMEIRO
                const éVendaNova = await salvarVenda(vendaParaSalvar);

                // 2. SÓ SE A VENDA FOR NOVA, ENVIA PARA A UTMIFY
                if (éVendaNova) {
                    console.log(`🚀 Venda nova (${transaction_id}). Enviando para a API da UTMify...`);

                    const nomeMatch = texto.match(nomeCompletoRegex);
                    const emailMatch = texto.match(emailRegex);
                    const metodoPagamentoMatch = texto.match(metodoPagamentoRegex);
                    const plataformaPagamentoMatch = texto.match(plataformaPagamentoRegex);

                    const payload = {
                        orderId: transaction_id,
                        platform: plataformaPagamentoMatch ? plataformaPagamentoMatch[1].trim() : 'UnknownPlatform',
                        paymentMethod: metodoPagamentoMatch ? metodoPagamentoMatch[1].trim().toLowerCase().replace(' ', '_') : 'unknown',
                        status: 'paid',
                        createdAt: moment.utc().format('YYYY-MM-DD HH:mm:ss'),
                        approvedDate: moment.utc().format('YYYY-MM-DD HH:mm:ss'),
                        customer: {
                            name: nomeMatch ? nomeMatch[1].trim() : "Cliente Desconhecido",
                            email: emailMatch ? emailMatch[1].trim() : "desconhecido@email.com",
                            ip: ipClienteFrontend,
                        },
                        products: [{
                            id: 'acesso-vip-bundle',
                            name: 'Acesso VIP',
                            quantity: 1,
                            priceInCents: Math.round(valorLiquidoNum * 100)
                        }],
                        trackingParameters: utmsEncontradas,
                        commission: {
                            totalPriceInCents: Math.round(valorLiquidoNum * 100),
                            gatewayFeeInCents: 0,
                            userCommissionInCents: Math.round(valorLiquidoNum * 100),
                            currency: 'BRL'
                        },
                        isTest: false
                    };
                    
                    const res = await axios.post('https://api.utmify.com.br/api-credentials/orders', payload, {
                        headers: { 'x-api-token': process.env.API_KEY, 'Content-Type': 'application/json' }
                    });

                    console.log('📬 [BOT] Resposta da UTMify:', res.status, res.data);
                }
            } catch (err) {
                console.error('❌ Erro fatal no processamento da mensagem:', err.message);
                if (err.response) {
                    console.error('🛑 Detalhes do erro da API:', err.response.data);
                }
            }
        }, new NewMessage({ incoming: true }));

    })();
});
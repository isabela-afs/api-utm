const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const input = require('input');
const moment = require('moment');
const axios = require('axios');
const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(express.json());

const apiId = 23313993; 
const apiHash = 'd9249aed345807c04562fb52448a878c'; 
const stringSession = new StringSession(process.env.TELEGRAM_SESSION || '1AQAOMTQ5LjE1NC4xNzUuNjABu2GwozhcqLzaslIxvjgKuyk0SDJOEFBzd2qqrR428YPK3C/yA0s3sj/yqOkDNiiG3KXnmrXlVg/ro/XUM5PzR8bIQjLpVfMWxAbmqhJhsoIG7d0J58nIEnPqVDtc51L45kUMJhap/TdsVIuFaF2c2v5ZsHB/rAJGHY3mkbWR2l+3ovwnK4CCe4vfOt1uY7rK26drUUa4cWPANgREig7ODg6xbVo/7nnaiGwNLLyRF2qom47FSY6om+knu6ZTUE94romAPhp4cIwe2KP0Qdci4eWLHKdxf/lvY82epq5BHxFauPty7LoyLVemGbRHRGx2d2OAHrbxqFQcnZw/WephQ1g=');
const CHAT_ID = BigInt(-1002733614113); 

const PORT = process.env.PORT || 3000; 

// Mapa temporário para associar user_id do Telegram ao fbclid
// NOTA: Para produção, isso deveria ser persistido em banco de dados!
const userFbclidMap = new Map();

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
    try {
        const client = await pool.connect();
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
        client.release();
    } catch (err) {
        console.error('❌ Erro ao configurar tabelas no PostgreSQL:', err.message);
        process.exit(1);
    }
}

// --- FUNÇÕES DE UTILIDADE PARA O BANCO DE DADOS (AGORA COM PG) ---

function gerarChaveUnica({ transaction_id }) {
    return `chave-${transaction_id}`;
}

function gerarHash({ transaction_id }) {
    return `hash-${transaction_id}`;
}

async function salvarVenda(venda) {
    console.log('💾 Tentando salvar venda no banco (PostgreSQL)...');
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

    try {
        const res = await pool.query(sql, valores);
        if (res.rowCount > 0) {
            console.log('✅ Venda salva no PostgreSQL!');
        } else {
            console.log('🔁 Venda já existia no PostgreSQL, ignorando inserção (hash duplicado).');
        }
    } catch (err) {
        console.error('❌ Erro ao salvar venda no DB (PostgreSQL):', err.message);
    }
}

async function vendaExiste(hash) {
    console.log(`🔎 Verificando se venda com hash ${hash} existe no PostgreSQL...`);
    const sql = 'SELECT COUNT(*) AS total FROM vendas WHERE hash = $1';
    try {
        const res = await pool.query(sql, [hash]);
        return res.rows[0].total > 0;
    } catch (err) {
        console.error('❌ Erro ao verificar venda existente (PostgreSQL):', err.message);
        return false;
    }
}

async function salvarFrontendUtms(data) {
    console.log('💾 Tentando salvar UTMs do frontend no banco (PostgreSQL)...');
    const sql = `
        INSERT INTO frontend_utms (
            timestamp_ms, valor, fbclid, utm_source, utm_medium,
            utm_campaign, utm_content, utm_term, ip
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
    `;

    const valores = [
        data.timestamp,
        data.valor,
        data.fbclid || null,
        data.utm_source || null,
        data.utm_medium || null,
        data.utm_campaign || null,
        data.utm_content || null,
        data.utm_term || null,
        data.ip || null
    ];

    try {
        await pool.query(sql, valores);
        console.log('✅ UTMs do frontend salvas no PostgreSQL!');
    } catch (err) {
        console.error('❌ Erro ao salvar UTMs do frontend no DB (PostgreSQL):', err.message);
    }
}

async function buscarUtmsPorFbclid(fbclid) {
    console.log(`🔎 Buscando UTMs do frontend por fbclid: ${fbclid}...`);
    const sql = 'SELECT * FROM frontend_utms WHERE fbclid = $1 ORDER BY received_at DESC LIMIT 1';
    try {
        const res = await pool.query(sql, [fbclid]);
        if (res.rows.length > 0) {
            console.log(`✅ UTMs encontradas para fbclid ${fbclid}.`);
            return res.rows[0];
        } else {
            console.log(`🔎 Nenhuma UTM do frontend encontrada para fbclid ${fbclid}.`);
            return null;
        }
    } catch (err) {
        console.error('❌ Erro ao buscar UTMs por fbclid (PostgreSQL):', err.message);
        return null;
    }
}

async function buscarUtmsPorTempoEValor(targetTimestamp, targetIp = null, windowMs = 120000) {
    console.log(`🔎 Buscando UTMs do frontend por timestamp ${targetTimestamp} (janela de ${windowMs / 1000}s)...`);
    const minTimestamp = targetTimestamp - windowMs;
    const maxTimestamp = targetTimestamp + windowMs;

    let sql = `
        SELECT * FROM frontend_utms
        WHERE timestamp_ms BETWEEN $1 AND $2
    `;
    let params = [minTimestamp, maxTimestamp];
    let paramIndex = 3;

    if (targetIp && targetIp !== 'telegram' && targetIp !== 'userbot') {
        sql += ` AND ip = $${paramIndex++}`;
        params.push(targetIp);
    }

    sql += ` ORDER BY ABS(timestamp_ms - $${paramIndex++}) ASC LIMIT 1`;
    params.push(targetTimestamp);

    try {
        const res = await pool.query(sql, params);
        if (res.rows.length > 0) {
            console.log(`✅ UTMs do frontend encontradas para timestamp ${targetTimestamp}.`);
            return res.rows[0];
        } else {
            console.log(`🔎 Nenhuma UTM do frontend encontrada para timestamp ${targetTimestamp} na janela.`);
            return null;
        }
    } catch (err) {
        console.error('❌ Erro ao buscar UTMs por tempo (PostgreSQL):', err.message);
        return null;
    }
}

// --- FUNÇÃO PARA LIMPAR DADOS ANTIGOS DA TABELA frontend_utms ---
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


// --- ENDPOINT HTTP PARA RECEBER UTMs DO FRONTEND ---
app.post('/frontend-utm-data', (req, res) => {
    const { timestamp, valor, fbclid, utm_source, utm_medium, utm_campaign, utm_content, utm_term, ip } = req.body;

    console.log('🚀 [BACKEND] Dados do frontend recebidos:', {
        timestamp, valor, fbclid, utm_source, utm_medium, utm_campaign, utm_content, utm_term, ip
    });

    if (!timestamp || valor === undefined || valor === null) {
        return res.status(400).send('Timestamp e Valor são obrigatórios.');
    }

    salvarFrontendUtms({
        timestamp,
        valor,
        fbclid,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_content,
        utm_term,
        ip
    });

    res.status(200).send('Dados recebidos com sucesso!');
});

// --- NOVO: Endpoint para ping (manter o serviço ativo) ---
app.get('/ping', (req, res) => {
    console.log('💚 [PING] Recebida requisição /ping. Serviço está ativo.');
    res.status(200).send('Pong!');
});


// --- INICIALIZA O SERVIDOR HTTP PRIMEIRO ---
app.listen(PORT, () => {
    console.log(`🌐 Servidor HTTP Express escutando na porta ${PORT}.`);
    console.log('Este servidor ajuda a manter o bot ativo em plataformas de hospedagem e recebe dados do frontend.');

    // Configura o auto-ping
    const pingInterval = 20 * 1000; // 20 segundos
    setInterval(() => {
        // Use a URL interna do servidor para o auto-ping
        // Para Render.com, é mais eficaz um serviço externo pingando a URL pública.
        axios.get(`http://localhost:${PORT}/ping`)
            .then(response => {
                // console.log(`💚 Auto-ping bem-sucedido: ${response.status}`); // Descomentar para ver pings no log
            })
            .catch(error => {
                console.error(`💔 Erro no auto-ping: ${error.message}`);
            });
    }, pingInterval);
    console.log(`⚡ Auto-ping configurado para cada ${pingInterval / 1000} segundos.`);


    // --- APÓS O SERVIDOR HTTP ESTAR ESCUTANDO, INICIA AS TAREFAS ASSÍNCRONAS ---
    (async () => {
        // Configura o banco de dados
        try {
            await setupDatabase();
            console.log('✅ Configuração do banco de dados concluída.');
        } catch (dbError) {
            console.error('❌ Erro fatal na configuração do banco de dados:', dbError.message);
            process.exit(1);
        }

        limparFrontendUtmsAntigos();

        setInterval(limparFrontendUtmsAntigos, 60 * 60 * 1000);
        console.log('🧹 Limpeza de UTMs antigos agendada para cada 1 hora.');

        console.log('Iniciando userbot...');
        const client = new TelegramClient(stringSession, apiId, apiHash, {
            connectionRetries: 5,
        });

        try {
            await client.start({
                phoneNumber: async () => input.text('Digite seu número com DDI (ex: +5511987654321): '),
                password: async () => input.text('Senha 2FA (se tiver): '),
                phoneCode: async () => input.text('Código do Telegram: '),
                onError: (err) => console.log('Erro durante o login/start do cliente:', err),
            });
            console.log('✅ Userbot conectado!');
            console.log('🔑 Nova StringSession para .env (após o primeiro login):', client.session.save());
        } catch (error) {
            console.error('❌ Falha ao iniciar o userbot:', error.message);
            process.exit(1);
        }

        // --- MANIPULAÇÃO DE MENSAGENS ---
        client.addEventHandler(async (event) => {
            const message = event.message;
            if (!message) return;

            const chat = await message.getChat();
            const incomingChatId = chat.id;

            let normalizedIncomingChatId = incomingChatId;
            if (typeof incomingChatId === 'bigint') {
                if (incomingChatId < 0 && incomingChatId.toString().startsWith('-100')) {
                    normalizedIncomingChatId = BigInt(incomingChatId.toString().substring(4));
                } else if (incomingChatId < 0) {
                    normalizedIncomingChatId = BigInt(incomingChatId * BigInt(-1));
                }
            } else {
                normalizedIncomingChatId = BigInt(Math.abs(Number(incomingChatId)));
            }

            let normalizedConfiguredChatId = CHAT_ID;
            if (typeof CHAT_ID === 'bigint') {
                if (CHAT_ID < 0 && CHAT_ID.toString().startsWith('-100')) {
                    normalizedConfiguredChatId = BigInt(CHAT_ID.toString().substring(4));
                } else if (CHAT_ID < 0) {
                    normalizedConfiguredChatId = BigInt(CHAT_ID * BigInt(-1));
                }
            } else {
                normalizedConfiguredChatId = BigInt(Math.abs(Number(CHAT_ID)));
            }

            if (normalizedIncomingChatId !== normalizedConfiguredChatId) {
                return;
            }

            let texto = (message.message || '').replace(/\r/g, '').trim();

            if (texto.startsWith('/start ')) {
                const startPayload = decodeURIComponent(texto.substring('/start '.length).trim());
                userFbclidMap.set(message.senderId.toString(), startPayload); 
                console.log(`🤖 [BOT] User ${message.senderId} iniciado com payload: ${startPayload}`);
                return;
            }

            const idRegex = /ID\s+Transa(?:ç|c)[aã]o\s+Gateway[:：]?\s*([\w-]{10,})/i;
            const valorLiquidoRegex = /Valor\s+L[ií]quido[:：]?\s*R?\$?\s*([\d.,]+)/i;
            const codigoDeVendaRegex = /Código\s+de\s+Venda[:：]?\s*(.+)/i;
            const nomeCompletoRegex = /Nome\s+Completo[:：]?\s*(.+)/i;
            const emailRegex = /E-mail[:：]?\s*(\S+@\S+\.\S+)/i;
            const metodoPagamentoRegex = /M[ée]todo\s+Pagamento[:：]?\s*(.+)/i;
            const plataformaPagamentoRegex = /Plataforma\s+Pagamento[:：]?\s*(.+)/i;


            const idMatch = texto.match(idRegex);
            const valorLiquidoMatch = texto.match(valorLiquidoRegex);
            const codigoDeVendaMatch = texto.match(codigoDeVendaRegex);

            const telegramMessageTimestamp = message.date * 1000;

            const nomeMatch = texto.match(nomeCompletoRegex);
            const emailMatch = texto.match(emailRegex);
            const metodoPagamentoMatch = texto.match(metodoPagamentoRegex);
            const plataformaPagamentoMatch = texto.match(plataformaPagamentoRegex);

            const customerName = nomeMatch ? nomeMatch[1].trim() : "Cliente Desconhecido";
            const customerEmail = emailMatch ? emailMatch[1].trim() : "desconhecido@email.com";
            const paymentMethod = metodoPagamentoMatch ? metodoPagamentoMatch[1].trim().toLowerCase().replace(' ', '_') : 'unknown';
            const platform = plataformaPagamentoMatch ? plataformaPagamentoMatch[1].trim() : 'UnknownPlatform';
            const status = 'paid';

            if (!idMatch || !valorLiquidoMatch) {
                console.log('⚠️ Mensagem sem dados completos de venda (ID da Transação Gateway ou Valor Líquido não encontrados).');
                return;
            }

            try {
                const transaction_id = idMatch[1].trim();
                const valorLiquidoNum = parseFloat(valorLiquidoMatch[1].replace(/\./g, '').replace(',', '.').trim());

                if (isNaN(valorLiquidoNum) || valorLiquidoNum <= 0) {
                    console.log('⚠️ Valor Líquido numérico inválido ou menor/igual a zero:', valorLiquidoMatch[1]);
                    return;
                }

                const chave = gerarChaveUnica({ transaction_id });
                const hash = gerarHash({ transaction_id });

                const jaExiste = await vendaExiste(hash);
                if (jaExiste) {
                    console.log(`🔁 Venda com hash ${hash} já registrada. Ignorando duplicata.`);
                    return;
                }

                let utmsEncontradas = {
                    utm_source: null,
                    utm_medium: null,
                    utm_campaign: null,
                    utm_content: null,
                    utm_term: null
                };
                let ipClienteFrontend = 'telegram';
                let matchedFrontendUtms = null;

                const userAssociatedFbclid = userFbclidMap.get(message.senderId.toString());
                if (userAssociatedFbclid && userAssociatedFbclid !== 'no_fbclid') {
                    console.log(`🤖 [BOT] Tentando encontrar UTMs por fbclid associado ao user_id: ${userAssociatedFbclid}`);
                    matchedFrontendUtms = await buscarUtmsPorFbclid(userAssociatedFbclid);
                } else if (codigoDeVendaMatch) {
                    const extractedCodigoDeVenda = codigoDeVendaMatch[1].trim();
                    console.log(`🤖 [BOT] Tentando encontrar UTMs por Código de Venda extraído da mensagem: ${extractedCodigoDeVenda}`);
                    matchedFrontendUtms = await buscarUtmsPorFbclid(extractedCodigoDeVenda);
                }
                
                if (!matchedFrontendUtms) {
                    console.log(`🤖 [BOT] Fallback: Nenhuma UTM encontrada por fbclid/código de venda. Tentando correspondência por tempo para ${transaction_id}.`);
                    matchedFrontendUtms = await buscarUtmsPorTempoEValor(
                        telegramMessageTimestamp,
                        null
                    );
                }

                if (matchedFrontendUtms) {
                    utmsEncontradas.utm_source = matchedFrontendUtms.utm_source;
                    utmsEncontradas.utm_medium = matchedFrontendUtms.utm_medium;
                    utmsEncontradas.utm_campaign = matchedFrontendUtms.utm_campaign;
                    utmsEncontradas.utm_content = matchedFrontendUtms.utm_content;
                    utmsEncontradas.utm_term = matchedFrontendUtms.utm_term;
                    ipClienteFrontend = matchedFrontendUtms.ip || 'frontend_matched';
                    console.log(`✅ [BOT] UTMs para ${transaction_id} atribuídas!`);
                } else {
                    console.log(`⚠️ [BOT] Nenhuma UTM correspondente encontrada para ${transaction_id}. Enviando para UTMify sem UTMs de atribuição.`);
                }

                const orderId = transaction_id;
                const agoraUtc = moment.utc().format('YYYY-MM-DD HH:mm:ss');

                const payload = {
                    orderId: orderId,
                    platform: platform,
                    paymentMethod: paymentMethod,
                    status: status,
                    createdAt: agoraUtc,
                    approvedDate: agoraUtc,
                    customer: {
                        name: customerName,
                        email: customerEmail,
                        phone: null,
                        document: null,
                        country: 'BR',
                        ip: ipClienteFrontend,
                    },
                    products: [
                        {
                            id: 'acesso-vip-bundle',
                            name: 'Acesso VIP',
                            planId: null,
                            planName: null,
                            quantity: 1,
                            priceInCents: Math.round(valorLiquidoNum * 100)
                        }
                    ],
                    trackingParameters: utmsEncontradas,
                    commission: {
                        totalPriceInCents: Math.round(valorLiquidoNum * 100),
                        gatewayFeeInCents: 0,
                        userCommissionInCents: Math.round(valorLiquidoNum * 100),
                        currency: 'BRL'
                    },
                    isTest: false
                };

                for (const key in payload.trackingParameters) {
                    if (payload.trackingParameters[key] === '') {
                        payload.trackingParameters[key] = null;
                    }
                }

                const res = await axios.post('https://api.utmify.com.br/api-credentials/orders', payload, {
                    headers: {
                        'x-api-token': process.env.API_KEY,
                        'Content-Type': 'application/json'
                    }
                });

                console.log('📬 [BOT] Resposta da UTMify:', res.status, res.data);
                console.log('📦 [BOT] Pedido criado na UTMify:', res.data);

                salvarVenda({
                    chave,
                    hash,
                    valor: valorLiquidoNum,
                    utm_source: utmsEncontradas.utm_source,
                    utm_medium: utmsEncontradas.utm_medium,
                    utm_campaign: utmsEncontradas.utm_campaign,
                    utm_content: utmsEncontradas.utm_content,
                    utm_term: utmsEncontradas.utm_term,
                    orderId,
                    transaction_id,
                    ip: ipClienteFrontend,
                    userAgent: 'userbot'
                });

            } catch (err) {
                console.error('❌ [BOT] Erro ao processar mensagem ou enviar para UTMify:', err.message);
                if (err.response) {
                    console.error('🛑 [BOT] Código de status da UTMify:', err.response.status);
                    console.error('📩 [BOT] Resposta de erro da UTMify:', err.response.data);
                }
            }

        }, new NewMessage({ chats: [CHAT_ID], incoming: true }));
    })();
});
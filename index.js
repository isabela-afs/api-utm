const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const input = require('input');
const sqlite3 = require('sqlite3').verbose();
const moment = require('moment');
const axios = require('axios');
require('dotenv').config();

const apiId = 23313993;
const apiHash = 'd9249aed345807c04562fb52448a878c';
const stringSession = new StringSession('1AQAOMTQ5LjE1NC4xNzUuNjABu00Kc0Y0I1pzQX3UBNIlr\i0BNXx52vhnSJWQGyiHGdt6D3XEkp9OqGshIA2HOoEbEKKSRUlHdNULxc6qqb2IbaScSTzL2x9FlUiT0+vCVSakP7x7orfEwafLqP8lwePeOzdkjgOgtcf218o9xxnKIL4jDPFAJzfeedwpHYrokJ63CwKQhEbx1hReYs1tDXhweT9qNjguDDRqv35kwT3YkrPETCdJtVjPY1frnUYZVX0\Bx3XMSbdtSRoyJh+P0vc5Xsebp3Y3bRzKnpngW63TehCJDxD\v07hoquWDyQ7KMSP4XQfA9AAhRoXuOa62F3n+oPVgHP8zvlPi6VaMR1bc=');
const CHAT_ID = BigInt(-1002733614113);

const db = new sqlite3.Database('banco.db', err => {
    if (err) console.error('Erro DB ao conectar:', err.message);
    else console.log('🗄️ SQLite conectado');
});

db.run(`
    CREATE TABLE IF NOT EXISTS vendas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chave TEXT UNIQUE,
        hash TEXT UNIQUE,
        valor REAL,
        utm_source TEXT,
        utm_medium TEXT,
        utm_campaign TEXT,
        utm_content TEXT,
        utm_term TEXT,
        orderId TEXT,
        transaction_id TEXT,
        ip TEXT,
        userAgent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`, (err) => {
    if (err) {
        console.error('❌ Erro ao criar/verificar tabela de vendas:', err.message);
    } else {
        console.log('✅ Tabela "vendas" verificada/criada.');
    }
});

// --- FUNÇÕES DE UTILIDADE PARA O BANCO DE DADOS ---

function gerarChaveUnica({ transaction_id }) {
    return `chave-${transaction_id}`;
}

function gerarHash({ transaction_id }) {
    return `hash-${transaction_id}`;
}

function salvarVenda(venda) {
    console.log('💾 Tentando salvar venda no banco...');
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
            console.error('❌ Erro ao salvar venda no DB:', err.message);
        } else {
            console.log('✅ Venda salva no SQLite com ID:', this.lastID);
        }
    });
}

function vendaExiste(hash) {
    return new Promise((resolve, reject) => {
        const sql = 'SELECT COUNT(*) AS total FROM vendas WHERE hash = ?';
        db.get(sql, [hash], (err, row) => {
            if (err) {
                console.error('❌ Erro ao verificar venda existente:', err.message);
                reject(err);
            } else {
                resolve(row.total > 0);
            }
        });
    });
}

// --- INICIALIZAÇÃO DO USERBOT TELEGRAM ---
(async () => {
    console.log('Iniciando userbot...');
    const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
    });

    try {
        await client.start({
            phoneNumber: async () => await input.text('Digite seu número com DDI (ex: +5511987654321): '),
            password: async () => await input.text('Senha 2FA (se tiver): '),
            phoneCode: async () => await input.text('Código do Telegram: '),
            onError: (err) => console.log('Erro durante o login/start do cliente:', err),
        });
        console.log('✅ Userbot conectado!');
        console.log('🔑 StringSession salva (copie e cole no código para evitar login futuro):', client.session.save());
    } catch (error) {
        console.error('❌ Falha ao iniciar o userbot:', error.message);
        return;
    }

    // --- MANIPULAÇÃO DE MENSAGENS ---
    client.addEventHandler(async (event) => {
        const message = event.message;
        if (!message) return;

        const chat = await message.getChat();
        const incomingChatId = chat.id;

        // NORMALIZAÇÃO DO CHAT ID PARA COMPARAÇÃO
        // Se o incomingChatId for negativo e começar com -100, removemos o -100 e o sinal
        // Se for positivo, usamos ele como está.
        let normalizedIncomingChatId = incomingChatId;
        if (typeof incomingChatId === 'bigint') {
            if (incomingChatId < 0 && incomingChatId.toString().startsWith('-100')) {
                // Remove o '-100' e o sinal negativo para obter o ID "real" positivo
                normalizedIncomingChatId = BigInt(incomingChatId.toString().substring(4));
            } else if (incomingChatId < 0) {
                // Para outros IDs negativos que não começam com -100, pegamos o absoluto
                normalizedIncomingChatId = BigInt(incomingChatId * BigInt(-1));
            }
        } else {
             // Se não for BigInt, tenta converter para BigInt e pega o absoluto
             normalizedIncomingChatId = BigInt(Math.abs(Number(incomingChatId)));
        }

        // Fazemos o mesmo para o CHAT_ID configurado
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

        console.log(`[DEBUG] IDs Normalizados: Mensagem: ${normalizedIncomingChatId} (Tipo: ${typeof normalizedIncomingChatId}). Configurado: ${normalizedConfiguredChatId} (Tipo: ${typeof normalizedConfiguredChatId}).`);

        // Compara os IDs normalizados
        if (normalizedIncomingChatId !== normalizedConfiguredChatId) {
            console.log(`⚠️ Mensagem de um chat diferente. ID recebido (normalizado): ${normalizedIncomingChatId}, esperado (normalizado): ${normalizedConfiguredChatId}. Ignorando.`);
            return;
        }

        let texto = (message.message || '').replace(/\r/g, '').trim();
        console.log('📨 Nova mensagem do chat monitorado:', JSON.stringify(texto));

        const idRegex = /Transa(?:ç|c)[aã]o\s+Gateway[:：]?\s*([\w-]{10,})/i;
        const valorRegex = /Valor\s+L[ií]quido[:：]?\s*R?\$?\s*([\d.,]+)/i;

        const idMatch = texto.match(idRegex);
        const valorMatch = texto.match(valorRegex);

        console.log('🧩 ID transação (match):', idMatch ? idMatch[1] : '❌ Não encontrado');
        console.log('💰 Valor extraído (match):', valorMatch ? valorMatch[1] : '❌ Não encontrado');

        if (!idMatch || !valorMatch) {
            console.log('⚠️ Mensagem sem dados completos de venda (ID da Transação ou Valor Líquido não encontrados).');
            return;
        }

        try {
            const transaction_id = idMatch[1].trim();
            const valorNum = parseFloat(valorMatch[1].replace(/\./g, '').replace(',', '.').trim());

            if (isNaN(valorNum) || valorNum <= 0) {
                console.log('⚠️ Valor numérico inválido ou menor/igual a zero:', valorMatch[1]);
                return;
            }

            const chave = gerarChaveUnica({ transaction_id });
            const hash = gerarHash({ transaction_id });

            const jaExiste = await vendaExiste(hash);
            if (jaExiste) {
                console.log(`🔁 Venda com hash ${hash} já registrada. Ignorando duplicata.`);
                return;
            }

            const orderId = 'pedido-' + Date.now();
            const agoraUtc = moment.utc().format('YYYY-MM-DD HH:mm:ss');

            const trackingParameters = {
                utm_source: null,
                utm_campaign: null,
                utm_medium: null,
                utm_content: null,
                utm_term: null
            };

            const commission = {
                totalPriceInCents: Math.round(valorNum * 100),
                gatewayFeeInCents: 0,
                userCommissionInCents: Math.round(valorNum * 100)
            };

            const payload = {
                orderId,
                platform: 'PushinPay',
                paymentMethod: 'pix',
                status: 'paid',
                createdAt: agoraUtc,
                approvedDate: agoraUtc,
                refundedAt: null,
                customer: {
                    name: "ClienteTelegram",
                    email: "cliente@email.com",
                    phone: null,
                    document: null,
                    country: 'BR',
                    ip: 'telegram',
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

            console.log('📤 Enviando payload para UTMify:', JSON.stringify(payload, null, 2));

            const res = await axios.post('https://api.utmify.com.br/api-credentials/orders', payload, {
                headers: {
                    'x-api-token': process.env.API_KEY,
                    'Content-Type': 'application/json'
                }
            });

            console.log('📬 Resposta da UTMify:', res.status, res.data);
            console.log('📦 Pedido criado na UTMify:', res.data);

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
                ip: 'telegram',
                userAgent: 'userbot'
            });

        } catch (err) {
            console.error('❌ Erro ao processar mensagem ou enviar para UTMify:', err.message);
            if (err.response) {
                console.error('🛑 Código de status da UTMify:', err.response.status);
                console.error('📩 Resposta de erro da UTMify:', err.response.data);
            }
        }

    }, new NewMessage({ chats: [CHAT_ID], incoming: true }));
})();
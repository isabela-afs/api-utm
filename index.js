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
const stringSession = new StringSession('1AQAOMTQ5LjE1NC4xNzUuNjABuz+1Q9feCvA+Dip2wXs69msgn5aX2eNW5vI/EjRxWejG6P7wj+LQLFz3onE4DBASe09EyvG1OIsdbaNa4V7jMw3ogS2LM35YpcynV/VNVT8a3HNfNc3hQkQanlTTHFMWQcmIogvWn913fwnDrMbujcNU22MCMLqBXJ2i5Fb2lC52CqV3G5rGrCH8IlSIr8ADD21X0vx0N7WQo73poBJt/OSdR3DqyqspU4fpWGwifYA9i9l1uY7PTzGa9ZqFIzH0HBsz+fTj+TUy5JUv7BkiWhnxnFUwn3CbwA/osFXd2HGst9o/2UE7hJt+JtkBf9DRq+hjpvyzzlTwoWVI3uV0Fxc=');
const CHAT_ID = BigInt(-1002733614113);

// SQLite
const db = new sqlite3.Database('banco.db', err => {
  if (err) console.error('Erro DB:', err.message);
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
`);

function gerarChaveUnica({ transaction_id }) {
  return `chave-${transaction_id}`;
}

function gerarHash({ transaction_id }) {
  return `hash-${transaction_id}`;
}

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
    if (err) console.error('❌ Erro ao salvar venda:', err.message);
    else console.log('✅ Venda salva no SQLite com ID:', this.lastID);
  });
}

function vendaExiste(hash) {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT COUNT(*) AS total FROM vendas WHERE hash = ?';
    db.get(sql, [hash], (err, row) => {
      if (err) reject(err);
      else resolve(row.total > 0);
    });
  });
}

// Inicializa o Userbot
(async () => {
  console.log('Iniciando userbot...');
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await input.text('Digite seu número com DDI: '),
    password: async () => await input.text('Senha 2FA (se tiver): '),
    phoneCode: async () => await input.text('Código do Telegram: '),
    onError: (err) => console.log('Erro de login:', err),
  });

  console.log('✅ Userbot conectado!');
  console.log('🔑 StringSession:', client.session.save());

  client.addEventHandler(async (event) => {
    const message = event.message;
    if (!message) return;

    const chat = await message.getChat();
    console.log('🟣 Mensagem recebida de:', chat.id);
    console.log('📝 Conteúdo:', message.message || message.text || '[sem texto]');
    if (chat.id !== CHAT_ID) return;

    const texto = message.message || '';
    console.log('📨 Nova mensagem:', texto);

    // Extrai dados com regex
    const idRegex = /ID Transação Gateway[:：]?\s*([a-zA-Z0-9-]+)/i;
    const valorRegex = /Valor Líquido[:：]?\s*R\$?\s*([\d.,]+)/i;

    const idMatch = texto.match(idRegex);
    const valorMatch = texto.match(valorRegex);

    if (!idMatch || !valorMatch) {
      console.log('⚠️ Mensagem sem dados de venda.');
      return;
    }

    try {
      const transaction_id = idMatch[1].trim();
      const valorNum = parseFloat(valorMatch[1].replace('.', '').replace(',', '.').trim());

      const chave = gerarChaveUnica({ transaction_id });
      const hash = gerarHash({ transaction_id });

      const jaExiste = await vendaExiste(hash);
      if (jaExiste) {
        console.log('🔁 Venda já registrada.');
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

      const res = await axios.post('https://api.utmify.com.br/api-credentials/orders', payload, {
        headers: {
          'x-api-token': process.env.API_KEY,
          'Content-Type': 'application/json'
        }
      });

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
      console.error('❌ Erro ao processar mensagem:', err.message);
    }

  }, new NewMessage({ incoming: true, outgoing: true }));
})();

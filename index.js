const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
const sqlite3 = require('sqlite3').verbose();
const moment = require('moment');

const apiId = 23313993; // do my.telegram.org
const apiHash = 'd9249aed345807c04562fb52448a878c'; 
const stringSession = new StringSession('1AQAOMTQ5LjE1NC4xNzUuNjABuz+1Q9feCvA+Dip2wXs69msgn5aX2eNW5vI/EjRxWejG6P7wj+LQLFz3onE4DBASe09EyvG1OIsdbaNa4V7jMw3ogS2LM35YpcynV/VNVT8a3HNfNc3hQkQanlTTHFMWQcmIogvWn913fwnDrMbujcNU22MCMLqBXJ2i5Fb2lC52CqV3G5rGrCH8IlSIr8ADD21X0vx0N7WQo73poBJt/OSdR3DqyqspU4fpWGwifYA9i9l1uY7PTzGa9ZqFIzH0HBsz+fTj+TUy5JUv7BkiWhnxnFUwn3CbwA/osFXd2HGst9o/2UE7hJt+JtkBf9DRq+hjpvyzzlTwoWVI3uV0Fxc='); // colocar string salva aqui para logar automático

const CHAT_ID = BigInt(-1002733614113); // seu grupo (use BigInt pra IDs grandes)

const db = new sqlite3.Database('banco.db', (err) => {
  if (err) console.error('Erro DB:', err.message);
  else console.log('🗄️ SQLite conectado');
});

// Cria tabela caso não exista
db.run(`
  CREATE TABLE IF NOT EXISTS vendas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chave TEXT UNIQUE,
    hash TEXT UNIQUE,
    valor REAL,
    transaction_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

// Funções utilitárias
function gerarChaveUnica(transaction_id) {
  return `chave-${transaction_id}`;
}
function gerarHash(transaction_id) {
  return `hash-${transaction_id}`;
}

function salvarVenda(venda) {
  return new Promise((resolve, reject) => {
    const sql = `
      INSERT INTO vendas (chave, hash, valor, transaction_id)
      VALUES (?, ?, ?, ?)
    `;
    const valores = [
      venda.chave,
      venda.hash,
      venda.valor,
      venda.transaction_id
    ];
    db.run(sql, valores, function(err) {
      if (err) reject(err);
      else resolve(this.lastID);
    });
  });
}

function vendaExiste(hash) {
  return new Promise((resolve, reject) => {
    db.get('SELECT 1 FROM vendas WHERE hash = ? LIMIT 1', [hash], (err, row) => {
      if (err) reject(err);
      else resolve(!!row);
    });
  });
}

(async () => {
  console.log('Iniciando userbot...');
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await input.text('Digite seu número com código do país (ex: +55xxxxxxxxxx): '),
    password: async () => await input.text('Digite a senha 2FA, se tiver: '),
    phoneCode: async () => await input.text('Digite o código que recebeu no Telegram: '),
    onError: (err) => console.log('Erro no login:', err),
  });

  console.log('✅ Userbot conectado!');

  console.log('Salve essa Session String para login automático no futuro:\n', client.session.save());

  client.addEventHandler(async (event) => {
    const message = event.message;
    if (!message) return;

    // Só processa mensagens no seu grupo
    const chat = await message.getChat();
    if (chat.id !== CHAT_ID) return;

    const texto = message.message || '';
    if (!texto) return;

    console.log('Mensagem no grupo:', texto);

    // Regex para ID transação e valor
    const idRegex = /ID Transação Gateway[:：]?\s*([a-zA-Z0-9-]+)/i;
    const valorRegex = /Valor Líquido[:：]?\s*R\$?\s*([\d.,]+)/i;

    const idMatch = texto.match(idRegex);
    const valorMatch = texto.match(valorRegex);

    if (!idMatch || !valorMatch) {
      console.log('Mensagem não contém dados de venda');
      return;
    }

    try {
      const transaction_id = idMatch[1].trim();
      const valorNum = parseFloat(valorMatch[1].replace('.', '').replace(',', '.').trim());

      const chave = gerarChaveUnica(transaction_id);
      const hash = gerarHash(transaction_id);

      const jaExiste = await vendaExiste(hash);
      if (jaExiste) {
        console.log('Venda já existe no banco, ignorando.');
        return;
      }

      await salvarVenda({ chave, hash, valor: valorNum, transaction_id });
      console.log(`✅ Venda salva: transaction_id=${transaction_id} valor=R$${valorNum.toFixed(2)}`);

    } catch (e) {
      console.error('Erro ao salvar venda:', e);
    }

  }, new (require('telegram/events').NewMessage)());

})();

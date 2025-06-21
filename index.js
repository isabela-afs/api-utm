const express = require('express');
const axios = require('axios');
require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// 📦 Banco de dados
const dbPath = path.resolve(__dirname, 'banco.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Erro ao conectar no banco:', err.message);
    } else {
        console.log('🗄️ Banco conectado com sucesso');
    }
});

// 🔧 Cria tabela se não existir (com IP e User-Agent)
db.run(`CREATE TABLE IF NOT EXISTS vendas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chave TEXT,
    hash TEXT UNIQUE,
    valor REAL,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    utm_content TEXT,
    utm_term TEXT,
    orderId TEXT,
    timestamp INTEGER,
    ip TEXT,
    user_agent TEXT
)`);

// 🔑 Função para gerar chave única
function gerarChaveUnica({ valor, utm_source, utm_medium, utm_campaign, utm_content, utm_term, ip, userAgent }) {
    return `${valor}|${utm_source}|${utm_medium}|${utm_campaign}|${utm_content}|${utm_term}|${ip}|${userAgent}`;
}

// 🔐 Função para gerar hash
function gerarHash({ valor, utm_source, utm_medium, utm_campaign, utm_content, utm_term, ip, userAgent }) {
    return crypto
        .createHash('sha256')
        .update(`${valor}-${utm_source}-${utm_medium}-${utm_campaign}-${utm_content}-${utm_term}-${ip}-${userAgent}`)
        .digest('hex');
}

// 🔍 Verifica se já existe no banco nos últimos 2 dias
function vendaExiste(hash) {
    const doisDiasEmSegundos = 2 * 24 * 60 * 60;
    const agora = Math.floor(Date.now() / 1000);
    const limite = agora - doisDiasEmSegundos;

    return new Promise((resolve, reject) => {
        db.get(`SELECT * FROM vendas WHERE hash = ? AND timestamp >= ?`, [hash, limite], (err, row) => {
            if (err) reject(err);
            resolve(!!row);
        });
    });
}

// 💾 Salva venda no banco
function salvarVenda({ chave, hash, valor, utm_source, utm_medium, utm_campaign, utm_content, utm_term, orderId, ip, userAgent }) {
    const timestamp = Math.floor(Date.now() / 1000);
    db.run(`INSERT INTO vendas (chave, hash, valor, utm_source, utm_medium, utm_campaign, utm_content, utm_term, orderId, timestamp, ip, user_agent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [chave, hash, valor, utm_source, utm_medium, utm_campaign, utm_content, utm_term, orderId, timestamp, ip, userAgent]);
}

// 🚦 Endpoint principal
app.get('/marcar-venda', async (req, res) => {
    const { valor, utm_source, utm_medium, utm_campaign, utm_content, utm_term } = req.query;

    if (!valor) {
        return res.status(400).json({ error: 'Parâmetro valor é obrigatório' });
    }

    const valorNum = parseFloat(valor);
    if (isNaN(valorNum)) {
        return res.status(400).json({ error: 'Valor inválido' });
    }

    const ipCliente = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'desconhecido';

    const chave = gerarChaveUnica({ valor: valorNum, utm_source, utm_medium, utm_campaign, utm_content, utm_term, ip: ipCliente, userAgent });
    const hash = gerarHash({ valor: valorNum, utm_source, utm_medium, utm_campaign, utm_content, utm_term, ip: ipCliente, userAgent });
    const orderId = 'pedido-' + Date.now();
    const agora = new Date().toISOString().replace('T', ' ').substring(0, 19);

    try {
        const jaExiste = await vendaExiste(hash);

        if (jaExiste) {
            return res.status(200).json({ success: false, message: '⚠️ Venda já registrada anteriormente (dentro de 2 dias)' });
        }

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
            trackingParameters: {
                src: null,
                sck: null,
                utm_source: utm_source || null,
                utm_campaign: utm_campaign || null,
                utm_medium: utm_medium || null,
                utm_content: utm_content || null,
                utm_term: utm_term || null
            },
            commission: {
                totalPriceInCents: Math.round(valorNum * 100),
                gatewayFeeInCents: 0,
                userCommissionInCents: Math.round(valorNum * 100)
            },
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
            utm_source,
            utm_medium,
            utm_campaign,
            utm_content,
            utm_term,
            orderId,
            ip: ipCliente,
            userAgent
        });

        return res.status(200).json({
            success: true,
            message: '✅ Pedido criado e registrado com sucesso na UTMify',
            data: response.data
        });

    } catch (error) {
        console.error('Erro ao criar pedido:', error.response?.data || error.message);
        return res.status(500).json({
            error: 'Erro ao criar pedido',
            details: error.response?.data || error.message
        });
    }
});

// 🔍 Endpoint para listar vendas (JSON)
app.get('/listar-vendas', (req, res) => {
    db.all(`SELECT * FROM vendas ORDER BY timestamp DESC`, (err, rows) => {
        if (err) {
            console.error('Erro ao buscar vendas:', err.message);
            return res.status(500).json({ error: 'Erro ao buscar vendas' });
        }
        res.json(rows);
    });
});

// 🖥️ Painel web para visualizar vendas
app.get('/painel', (req, res) => {
    db.all(`SELECT * FROM vendas ORDER BY timestamp DESC`, (err, rows) => {
        if (err) {
            console.error('Erro ao buscar vendas:', err.message);
            return res.status(500).send('Erro ao buscar vendas');
        }

        const html = `
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <title>Painel de Vendas</title>
            <style>
                body { font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px; }
                h1 { color: #333; }
                table { width: 100%; border-collapse: collapse; background: white; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
                th, td { padding: 10px; border: 1px solid #ccc; text-align: left; }
                th { background: #007bff; color: white; }
                tr:nth-child(even) { background: #f9f9f9; }
                tr:hover { background: #e0f7fa; }
            </style>
        </head>
        <body>
            <h1>Painel de Vendas</h1>
            <table>
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Order ID</th>
                        <th>Valor</th>
                        <th>UTM Source</th>
                        <th>UTM Medium</th>
                        <th>UTM Campaign</th>
                        <th>UTM Content</th>
                        <th>UTM Term</th>
                        <th>IP</th>
                        <th>User-Agent</th>
                        <th>Data</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(v => `
                        <tr>
                            <td>${v.id}</td>
                            <td>${v.orderId}</td>
                            <td>R$ ${v.valor.toFixed(2)}</td>
                            <td>${v.utm_source || ''}</td>
                            <td>${v.utm_medium || ''}</td>
                            <td>${v.utm_campaign || ''}</td>
                            <td>${v.utm_content || ''}</td>
                            <td>${v.utm_term || ''}</td>
                            <td>${v.ip || ''}</td>
                            <td>${v.user_agent || ''}</td>
                            <td>${new Date(v.timestamp * 1000).toLocaleString('pt-BR')}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </body>
        </html>
        `;
        res.send(html);
    });
});

// 🚀 Inicia servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
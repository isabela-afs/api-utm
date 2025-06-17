const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

app.post('/criar-pedido', async (req, res) => {
    const { nome, email, valor, utm_source, utm_medium, utm_campaign, utm_content, utm_term } = req.body;

    if (!nome || !email || !valor) {
        return res.status(400).json({ error: 'Nome, email e valor são obrigatórios' });
    }

    const agora = new Date().toISOString().replace('T', ' ').substring(0, 19);

    const payload = {
        orderId: 'pedido-' + Date.now(),
        platform: 'PushinPay',
        paymentMethod: 'pix',
        status: 'paid',
        createdAt: agora,
        approvedDate: agora,
        refundedAt: null,
        customer: {
            name: nome,
            email: email,
            phone: null,
            document: null,
            country: 'BR'
        },
        products: [
            {
                id: 'produto-1',
                name: 'Acesso VIP',
                planId: null,
                planName: null,
                quantity: 1,
                priceInCents: Math.round(valor * 100)
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
            totalPriceInCents: Math.round(valor * 100),
            gatewayFeeInCents: 0,
            userCommissionInCents: Math.round(valor * 100)
        },
        isTest: false
    };

    try {
        const response = await axios.post('https://api.utmify.com.br/api-credentials/orders', payload, {
            headers: {
                'x-api-token': process.env.API_KEY,
                'Content-Type': 'application/json'
            }
        });

        res.status(200).json({
            message: 'Pedido criado com sucesso na UTMify',
            data: response.data
        });
    } catch (error) {
        console.error('Erro ao criar pedido:', error.response?.data || error.message);
        res.status(500).json({
            error: 'Erro ao criar pedido',
            details: error.response?.data || error.message
        });
    }
});

app.get('/marcar-venda', async (req, res) => {
    const { valor, utm_source, utm_medium, utm_campaign, utm_content, utm_term, nome, email } = req.query;

    if (!nome || !email || !valor) {
        return res.status(400).json({ error: 'Parâmetros nome, email e valor são obrigatórios' });
    }

    const agora = new Date().toISOString().replace('T', ' ').substring(0, 19);

    const payload = {
        orderId: 'pedido-' + Date.now(),
        platform: 'PushinPay',
        paymentMethod: 'pix',
        status: 'paid',
        createdAt: agora,
        approvedDate: agora,
        refundedAt: null,
        customer: {
            name: nome,
            email: email,
            phone: null,
            document: null,
            country: 'BR'
        },
        products: [
            {
                id: 'produto-1',
                name: 'Acesso VIP',
                planId: null,
                planName: null,
                quantity: 1,
                priceInCents: Math.round(valor * 100)
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
            totalPriceInCents: Math.round(valor * 100),
            gatewayFeeInCents: 0,
            userCommissionInCents: Math.round(valor * 100)
        },
        isTest: false
    };

    try {
        const response = await axios.post('https://api.utmify.com.br/api-credentials/orders', payload, {
            headers: {
                'x-api-token': process.env.API_KEY,
                'Content-Type': 'application/json'
            }
        });

        res.status(200).json({
            message: 'Pedido criado com sucesso na UTMify',
            data: response.data
        });
    } catch (error) {
        console.error('Erro ao criar pedido:', error.response?.data || error.message);
        res.status(500).json({
            error: 'Erro ao criar pedido',
            details: error.response?.data || error.message
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});

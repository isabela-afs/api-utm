require('dotenv').config();

const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID || '-1002733614113';

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

console.log('🤖 Bot Telegram rodando...');

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

        // Cria hash igual ao da rota
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
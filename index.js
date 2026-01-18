const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Inicializar cliente do WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// QR Code no console
client.on('qr', qr => {
    console.log('QR CODE:', qr);
});

// Quando conectar
client.on('ready', () => {
    console.log('✅ WhatsApp conectado!');
});

// Iniciar
client.initialize();

// Rota simples
app.get('/', (req, res) => {
    res.send('Bot WhatsApp está rodando! Verifique os logs para o QR Code.');
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});

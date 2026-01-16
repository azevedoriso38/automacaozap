// ==========================
//  IMPORTS
// ==========================
const { Client, LocalAuth } = require('whatsapp-web.js'); // Biblioteca WhatsApp
const express = require('express');                       // Servidor web simples
const qrcode = require('qrcode-terminal');                // Mostrar QR no log

// ==========================
//  CONFIGURAÇÃO DO SERVIDOR
// ==========================
const app = express();
const PORT = process.env.PORT || 3000; // Porta dinâmica para Render

// ==========================
//  CONFIGURAÇÃO DO WHATSAPP
// ==========================
const client = new Client({
    authStrategy: new LocalAuth(),   // Salva sessão localmente
    puppeteer: {
        args: [
            '--no-sandbox',           // Necessário para Render / VPS
            '--disable-setuid-sandbox'
        ]
    }
});

// ==========================
//  EVENTO QR CODE
// ==========================
client.on('qr', qr => {
    console.log('==============================');
    console.log('ESCANEIE O QR CODE ABAIXO:');
    console.log(qr);
    console.log('==============================');
    // Opcional: mostrar QR no terminal como gráfico
    qrcode.generate(qr, { small: true });
});

// ==========================
//  EVENTO PRONTO
// ==========================
client.on('ready', () => {
    console.log('✅ WhatsApp conectado!');
});

// ==========================
//  INICIALIZA CLIENTE
// ==========================
client.initialize();

// ==========================
//  ROTA DE TESTE DO SERVIDOR
// ==========================
app.get('/', (req, res) => {
    res.send('Servidor rodando ✅');
});

// ==========================
//  START DO SERVIDOR
// ==========================
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});

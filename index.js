const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração do cliente
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    }
});

// QR Code no console
client.on('qr', (qr) => {
    console.log('🔍 QR CODE PARA CONECTAR:');
    console.log('----------------------------------------');
    qrcode.generate(qr, { small: true });
    console.log('----------------------------------------');
    console.log('Acesse: https://qrcoderizer.com/');
    console.log('Cole o código acima para gerar imagem do QR');
    console.log('Ou copie este código para um gerador online:');
    console.log(qr);
});

// Quando conectar
client.on('ready', () => {
    console.log('✅ WHATSAPP CONECTADO COM SUCESSO!');
    console.log('🤖 Bot está pronto para receber mensagens');
});

// Lidar com mensagens
client.on('message', async (message) => {
    console.log(`📩 Mensagem de ${message.from}: ${message.body}`);
    
    // Responde a comandos básicos
    if (message.body.toLowerCase() === '!ping') {
        await message.reply('🏓 Pong!');
    }
    
    if (message.body.toLowerCase() === '!ajuda') {
        await message.reply('Comandos disponíveis:\n!ping - Testa o bot\n!ajuda - Mostra esta mensagem');
    }
});

// Iniciar o WhatsApp
client.initialize();

// Rota web simples
app.get('/', (req, res) => {
    res.send(`
        <html>
            <head><title>Bot WhatsApp</title></head>
            <body>
                <h1>🤖 Bot WhatsApp Online</h1>
                <p>Verifique os logs para ver o QR Code</p>
                <p>Depois de escanear, mande "!ping" para testar</p>
            </body>
        </html>
    `);
});

// Iniciar servidor web
app.listen(PORT, () => {
    console.log(`🌐 Servidor web rodando na porta ${PORT}`);
    console.log(`📱 Aguardando QR Code do WhatsApp...`);
});

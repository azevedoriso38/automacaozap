const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Servir arquivos estáticos (index.html)
app.use(express.static(__dirname));

// WhatsApp client
const client = new Client({
    authStrategy: new LocalAuth(),
    "puppeteer": "^21.3.0"
        executablePath: '/usr/bin/google-chrome', // Caminho do Chrome no Render
        headless: true,                           // Rodar sem interface gráfica
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});


// QR Code
client.on('qr', qr => {
    console.log('QR Code gerado');
    io.emit('qr', qr); // envia QR para o navegador
});

// Conectado
client.on('ready', () => {
    console.log('WhatsApp conectado');
    io.emit('ready');
});

// Inicializa WhatsApp
client.initialize();

// Socket
io.on('connection', socket => {
    console.log('Usuário conectado');

    socket.on('send-message', async data => {
        const { numbers, message } = data;

        const list = numbers.split(',').map(n => n.trim());

        for (let number of list) {
            const chatId = number.includes('@c.us')
                ? number
                : number + '@c.us';

            try {
                await client.sendMessage(chatId, message);
            } catch (err) {
                console.log('Erro ao enviar para', number);
            }
        }
    });
});

// Start server
server.listen(PORT, () => {
    console.log('Servidor rodando na porta ' + PORT);
});

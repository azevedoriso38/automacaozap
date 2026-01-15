const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Configuração do Express
app.use(express.json());
app.use(express.static(__dirname));

// Rota principal
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Inicialização do WhatsApp
let client = null;
let isConnected = false;
let isSending = false;
let sendQueue = [];

// Função para criar novo cliente
function createClient() {
    client = new Client({
        authStrategy: new LocalAuth({ dataPath: './whatsapp_auth' }),
        puppeteer: {
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            headless: true
        }
    });

    client.on('qr', async (qr) => {
        console.log('QR Code recebido');
        const qrImage = await qrcode.toDataURL(qr);
        io.emit('qr', qrImage);
    });

    client.on('ready', () => {
        console.log('WhatsApp conectado!');
        isConnected = true;
        io.emit('ready');
        io.emit('status', { connected: true, message: 'Conectado e pronto!' });
    });

    client.on('disconnected', () => {
        console.log('WhatsApp desconectado');
        isConnected = false;
        io.emit('disconnected');
        io.emit('status', { connected: false, message: 'Desconectado' });
        
        // Reconectar após 5 segundos
        setTimeout(() => {
            console.log('Tentando reconectar...');
            createClient();
            client.initialize();
        }, 5000);
    });

    client.initialize();
}

// Inicializar WhatsApp
createClient();

// Socket.io
io.on('connection', (socket) => {
    console.log('Novo cliente conectado:', socket.id);
    
    // Enviar status atual
    socket.emit('status', { 
        connected: isConnected, 
        message: isConnected ? 'Conectado' : 'Desconectado' 
    });

    // Comandos do cliente
    socket.on('connect-whatsapp', () => {
        if (!client) {
            createClient();
        } else if (!isConnected) {
            client.initialize();
        }
    });

    socket.on('disconnect-whatsapp', () => {
        if (client && isConnected) {
            client.destroy();
            isConnected = false;
        }
    });

    socket.on('check-status', () => {
        socket.emit('status', { 
            connected: isConnected, 
            message: isConnected ? 'Conectado' : 'Desconectado' 
        });
    });

    socket.on('send-messages', async (data) => {
        if (!isConnected) {
            socket.emit('send-error', 'WhatsApp não conectado');
            return;
        }

        if (isSending) {
            socket.emit('send-error', 'Já existe um envio em andamento');
            return;
        }

        isSending = true;
        sendQueue = data.recipients;
        const total = sendQueue.length;
        let sent = 0;

        for (const number of sendQueue) {
            if (!isSending) break;

            try {
                const formattedNumber = number.includes('@c.us') 
                    ? number 
                    : `${number}@c.us`;

                if (data.type === 'image') {
                    await client.sendMessage(formattedNumber, {
                        image: { url: data.mediaUrl },
                        caption: data.message
                    });
                } else {
                    await client.sendMessage(formattedNumber, data.message);
                }

                sent++;
                socket.emit('send-progress', {
                    sent,
                    total,
                    number,
                    status: '✅ Enviado'
                });

                // Delay entre mensagens
                if (sent < total) {
                    await new Promise(resolve => setTimeout(resolve, data.delay * 1000));
                }

            } catch (error) {
                console.error('Erro ao enviar:', error);
                socket.emit('send-progress', {
                    sent,
                    total,
                    number,
                    status: `❌ Erro: ${error.message}`
                });
            }
        }

        isSending = false;
        sendQueue = [];
        socket.emit('send-complete');
    });

    socket.on('stop-sending', () => {
        isSending = false;
        sendQueue = [];
    });

    socket.on('disconnect', () => {
        console.log('Cliente desconectado:', socket.id);
    });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Acesse: http://localhost:${PORT}`);
});

// Manter o Render ativo
setInterval(() => {
    if (client && isConnected) {
        console.log('Manutenção: Cliente ativo');
    }
}, 60000); // Ping a cada 1 minuto

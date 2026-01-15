const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const qrcode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));

let connected = false;

// Gerar QR Code fake para teste
function generateFakeQR() {
    const fakeData = `2@${Date.now()}${Math.random().toString(36).substr(2, 9)}`;
    qrcode.toDataURL(fakeData, (err, url) => {
        io.emit('qr', url);
        io.emit('status', { connected: false, message: 'Escaneie o QR Code' });
        
        // Simular conexão após 30 segundos
        setTimeout(() => {
            connected = true;
            io.emit('ready');
            io.emit('status', { connected: true, message: '✅ Conectado (Modo Teste)' });
        }, 30000);
    });
}

io.on('connection', (socket) => {
    console.log('Cliente conectado');
    
    socket.emit('status', { connected, message: connected ? 'Conectado' : 'Desconectado' });
    
    socket.on('connect-whatsapp', () => {
        console.log('Gerando QR Code...');
        generateFakeQR();
    });
    
    socket.on('send-messages', (data) => {
        if (!connected) {
            socket.emit('send-error', 'Conecte primeiro');
            return;
        }
        
        const numbers = data.recipients.filter(n => n.trim());
        let sent = 0;
        
        numbers.forEach((num, i) => {
            setTimeout(() => {
                sent++;
                socket.emit('send-progress', {
                    sent,
                    total: numbers.length,
                    number: num,
                    status: '✅ Simulado'
                });
                
                if (sent === numbers.length) {
                    socket.emit('send-complete', { sent, total: numbers.length, errors: 0 });
                }
            }, i * (data.delay || 2) * 1000);
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Servidor rodando na porta ${PORT}`);
});

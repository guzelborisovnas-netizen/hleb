const http = require('http');
const fs = require('fs');
const path = require('path');

// 1. Системный промпт ИИ-консультанта пекарни
const SYSTEM_PROMPT = `Ты — вежливый, приветливый и знающий виртуальный консультант пекарни «Хлебные Истории».
Отвечай кратко, тепло и по делу на русском языке.
Помогай посетителям с вопросами:
- О выпечке и десертах: багеты, классические круассаны и круассаны с начинками, синнабоны с корицей, булочки-косички, сердечки с сыром, ассорти, маскарпоне, клубника в шоколаде, кексы, пончики, блинчики, мини-пиццы, хот-доги.
- О свежести: всё печётся ежедневно на натуральном сливочном масле прямо из печи.
- О заказе и доставке: заказ можно собрать прямо на сайте (нажать «В заказ») и отправить в WhatsApp.
- О пекарне: адрес — ул. Любимая, 1; режим работы — ежедневно с 10:00 до 20:00; WhatsApp — +7 (777) 777-77-77.
Если гость спрашивает о том, чего нет в меню, вежливо предложи подходящую выпечку или десерт из нашего ассортимента.`;

// Загрузка переменных окружения из .env без внешних зависимостей
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
    }
  }
}
loadEnv();

const PORT = process.env.PORT || 3000;

// Карта MIME-типов для статических файлов
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  // CORS-заголовки
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Endpoint POST /api/chat
  if (pathname === '/api/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) req.destroy(); // Защита от перегрузки
    });

    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const userMessage = data.message?.trim();
        const incomingMessages = Array.isArray(data.messages) ? data.messages : [];

        if (!userMessage && incomingMessages.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Сообщение не может быть пустым.' }));
          return;
        }

        // Проверка наличия и корректности ключа OpenAI
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey || apiKey === 'вставьте_ваш_ключ_сюда' || apiKey.trim() === '') {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            error: 'Ключ OpenAI API не настроен. Откройте файл .env и укажите ваш действительный OPENAI_API_KEY.'
          }));
          return;
        }

        // Формирование цепочки сообщений для OpenAI
        const messagesPayload = [{ role: 'system', content: SYSTEM_PROMPT }];

        if (incomingMessages.length > 0) {
          for (const msg of incomingMessages) {
            if (msg.role && msg.content) {
              messagesPayload.push({
                role: msg.role === 'assistant' ? 'assistant' : 'user',
                content: String(msg.content)
              });
            }
          }
        } else if (userMessage) {
          messagesPayload.push({ role: 'user', content: userMessage });
        }

        // Запрос к OpenAI API (модель gpt-4o-mini)
        const openAiRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey.trim()}`
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: messagesPayload,
            temperature: 0.7,
            max_tokens: 600
          })
        });

        const openAiData = await openAiRes.json();

        if (!openAiRes.ok) {
          const errMsg = openAiData.error?.message || `Ошибка OpenAI (${openAiRes.status})`;
          res.writeHead(openAiRes.status, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: errMsg }));
          return;
        }

        const reply = openAiData.choices?.[0]?.message?.content || 'Извините, не удалось сформировать ответ.';
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ reply }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Внутренняя ошибка сервера: ' + err.message }));
      }
    });
    return;
  }

  // Обработка статических файлов (index.html и др.)
  if (req.method === 'GET' || req.method === 'HEAD') {
    let filePath = pathname === '/' ? '/index.html' : pathname;
    const safePath = path.normalize(path.join(__dirname, filePath));

    // Защита от выхода за пределы директории
    if (!safePath.startsWith(__dirname)) {
      res.writeHead(403);
      res.end('Access denied');
      return;
    }

    fs.stat(safePath, (err, stats) => {
      if (err || !stats.isFile()) {
        const indexPath = path.join(__dirname, 'index.html');
        fs.readFile(indexPath, (indexErr, content) => {
          if (indexErr) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 Not Found');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(content);
        });
        return;
      }

      const ext = path.extname(safePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      res.writeHead(200, { 'Content-Type': contentType });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      fs.createReadStream(safePath).pipe(res);
    });
    return;
  }

  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Method Not Allowed');
});

server.listen(PORT, () => {
  console.log(`Сервер «Хлебные Истории» запущен: http://localhost:${PORT}`);
});

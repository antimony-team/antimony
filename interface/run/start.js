import express from 'express';
import {createProxyMiddleware} from 'http-proxy-middleware';

const app = express();

// Optional proxy to redirect to backend for local deployment
if (process.argv.length > 2 && process.argv[2] === '--with-proxy') {
  const httpProxy = createProxyMiddleware({
    target: process.env.PROXY_URL ?? 'http://localhost:3000',
    changeOrigin: true,
    pathRewrite: {'^/api': ''},
  });

  const websocketProxy = createProxyMiddleware({
    target: process.env.PROXY_URL ?? 'http://localhost:3000',
    ws: true,
  });

  app.use('/api', httpProxy);
  app.use('/socket.io', websocketProxy);
}

app.use('/', express.static('../build'));
app.use('/*any', express.static('../build'));
app.use('/icons', express.static('../build/assets/icons'));
app.listen(8100);

console.log('[APP] Antimony is ready to serve!');

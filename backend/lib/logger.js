const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
    : undefined,
});

// Express request logging middleware
const requestLogger = (req, res, next) => {
  const start = Date.now();
  const { method, url } = req;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const { statusCode } = res;
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    logger[level]({ method, url, statusCode, duration: `${duration}ms` }, `${method} ${url} ${statusCode} ${duration}ms`);
  });

  next();
};

module.exports = { logger, requestLogger };

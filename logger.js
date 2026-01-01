// Enhanced logging utility for Legal Fighting Machine
const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

const logFile = path.join(logsDir, 'app.log');
const errorLogFile = path.join(logsDir, 'error.log');

function formatLog(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...meta
  };
  return JSON.stringify(logEntry) + '\n';
}

function writeLog(filename, content) {
  fs.appendFileSync(filename, content);
}

const logger = {
  info: (message, meta = {}) => {
    const logEntry = formatLog('INFO', message, meta);
    console.log(`[${new Date().toISOString()}] INFO: ${message}`);
    writeLog(logFile, logEntry);
  },

  error: (message, error = null, meta = {}) => {
    const errorMeta = {
      ...meta,
      stack: error?.stack,
      name: error?.name
    };
    const logEntry = formatLog('ERROR', message, errorMeta);
    console.error(`[${new Date().toISOString()}] ERROR: ${message}`, error?.stack || '');
    writeLog(errorLogFile, logEntry);
  },

  warn: (message, meta = {}) => {
    const logEntry = formatLog('WARN', message, meta);
    console.warn(`[${new Date().toISOString()}] WARN: ${message}`);
    writeLog(logFile, logEntry);
  },

  audit: (action, userId, details = {}) => {
    const auditEntry = formatLog('AUDIT', action, {
      userId,
      ...details,
      ip: details.ip || 'unknown'
    });
    writeLog(path.join(logsDir, 'audit.log'), auditEntry);
  }
};

module.exports = logger;
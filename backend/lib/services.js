const fs = require('fs');
const net = require('net');
const { SERVICES_FILE } = require('./constants');

const getServices = () => {
  try {
    return JSON.parse(fs.readFileSync(SERVICES_FILE, 'utf-8'));
  } catch (err) {
    return [];
  }
};

const saveServices = (services) => {
  fs.writeFileSync(SERVICES_FILE, JSON.stringify(services, null, 2));
};

const checkPort = (port) => {
  return new Promise((resolve) => {
    const conn = net.createConnection({ port, host: '127.0.0.1' });
    conn.on('connect', () => {
      conn.end();
      resolve(true);
    });
    conn.on('error', () => {
      resolve(false);
    });
  });
};

module.exports = { getServices, saveServices, checkPort };

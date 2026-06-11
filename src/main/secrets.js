// Шифрование секретов «на месте» через OS-хранилище (Electron safeStorage).
// Пароли/ключи SSH не лежат в открытом виде в конфиге.
const { safeStorage } = require('electron');

const PREFIX = 'enc:v1:';

function available() {
  try { return safeStorage && safeStorage.isEncryptionAvailable(); }
  catch { return false; }
}

function encrypt(plain) {
  if (plain == null || plain === '') return plain;
  if (typeof plain === 'string' && plain.startsWith(PREFIX)) return plain; // уже зашифровано
  if (!available()) return plain; // нет шифрования — оставляем как есть (best effort)
  try { return PREFIX + safeStorage.encryptString(String(plain)).toString('base64'); }
  catch { return plain; }
}

function decrypt(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value;
  if (!available()) return '';
  try { return safeStorage.decryptString(Buffer.from(value.slice(PREFIX.length), 'base64')); }
  catch { return ''; }
}

module.exports = { encrypt, decrypt, available };

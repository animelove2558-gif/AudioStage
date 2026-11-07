// File-name rules for files the app writes (plain Node, tested in tests/guards.test.js).
// Windows cannot create files named after devices (CON, NUL, COM1…, with or without an extension) and silently drops a
// trailing dot or space, so the name that was asked for would no longer match the file that was written.
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;
const ILLEGAL = /[\/:*?"<>|\x00-\x1f]/g;
const reserved = (name) => RESERVED.test(String(name).split('.')[0].replace(/[ .]+$/, ''));
/* true when `name` can be used as it is, on every platform */
function okName(name) {
  return typeof name === 'string' && name.length >= 1 && name.length <= 180 && !/[\/:*?"<>|\x00-\x1f]/.test(name)
    && name !== '.' && name !== '..' && !/[ .]$/.test(name) && !reserved(name);
}
/* a usable name made from any text: illegal characters become "_", trailing dots / spaces go, device names get a "_" in front */
function safeName(name, fallback = 'Untitled') {
  let n = String(name == null ? '' : name).replace(ILLEGAL, '_').replace(/[ .]+$/, '').replace(/^\s+/, '').slice(0, 180).replace(/[ .]+$/, '');
  if (!n || n === '.' || n === '..') n = fallback;
  if (reserved(n)) n = '_' + n;
  return n;
}
module.exports = { okName, safeName, reserved };

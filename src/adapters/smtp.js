// An SMTP client with no dependencies. It speaks EHLO, STARTTLS, AUTH PLAIN or LOGIN, MAIL, RCPT
// and DATA. Port 465 uses TLS from the first byte. Other ports upgrade with STARTTLS when the
// server offers it. Credentials are never sent over a plain connection unless allowInsecureAuth is
// set, which only a local test server should need.
import net from 'node:net';
import tls from 'node:tls';
import { buildMessage, addressOf } from './mime.js';

function reader(socket) {
  let buf = '';
  const waiting = [];
  const lines = [];
  let error = null;
  const pump = () => {
    while (waiting.length) {
      const idx = lines.findIndex((l) => /^\d{3} /.test(l));
      if (idx === -1) {
        if (error) waiting.shift().reject(error);
        return;
      }
      const block = lines.splice(0, idx + 1);
      const code = Number(block[block.length - 1].slice(0, 3));
      waiting.shift().resolve({ code, lines: block.map((l) => l.slice(4)) });
    }
  };
  const onData = (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\r\n')) !== -1) {
      lines.push(buf.slice(0, i));
      buf = buf.slice(i + 2);
    }
    pump();
  };
  const onError = (e) => {
    error = e;
    pump();
  };
  const onClose = () => onError(new Error('SMTP connection closed'));
  socket.on('data', onData);
  socket.on('error', onError);
  socket.on('close', onClose);
  return {
    next: () => new Promise((resolve, reject) => {
      waiting.push({ resolve, reject });
      pump();
    }),
    detach() {
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    },
  };
}

function connect(opts, secure, timeoutMs) {
  return new Promise((resolve, reject) => {
    const s = secure ? tls.connect(opts) : net.connect(opts);
    s.setTimeout(timeoutMs, () => s.destroy(new Error('SMTP timeout')));
    s.once(secure ? 'secureConnect' : 'connect', () => resolve(s));
    s.once('error', reject);
  });
}

export function smtpMailer({
  host,
  port = 587,
  secure = port === 465,
  user,
  pass,
  name = 'localhost',
  timeoutMs = 30000,
  rejectUnauthorized = true,
  allowInsecureAuth = false,
} = {}) {
  if (!host) throw new Error('smtpMailer needs a host');

  async function send(msg) {
    const { id, raw } = buildMessage(msg);
    let socket = await connect({ host, port, servername: host, rejectUnauthorized }, secure, timeoutMs);
    let r = reader(socket);
    const expect = async (codes, what) => {
      const res = await r.next();
      if (!codes.includes(res.code)) throw new Error(`SMTP ${what} failed: ${res.code} ${res.lines.join(' ')}`);
      return res;
    };
    const cmd = async (line, codes, what) => {
      socket.write(`${line}\r\n`);
      return expect(codes, what);
    };
    try {
      await expect([220], 'greeting');
      let ehlo = await cmd(`EHLO ${name}`, [250], 'EHLO');
      let encrypted = secure;
      if (!secure && ehlo.lines.some((l) => /^STARTTLS\b/i.test(l))) {
        await cmd('STARTTLS', [220], 'STARTTLS');
        r.detach();
        socket = await new Promise((resolve, reject) => {
          const t = tls.connect({ socket, servername: host, rejectUnauthorized }, () => resolve(t));
          t.once('error', reject);
        });
        r = reader(socket);
        encrypted = true;
        ehlo = await cmd(`EHLO ${name}`, [250], 'EHLO');
      }
      if (user) {
        if (!encrypted && !allowInsecureAuth) throw new Error('SMTP server offers no TLS; refusing to send credentials in clear text');
        const auth = ehlo.lines.find((l) => /^AUTH\b/i.test(l)) || '';
        if (/\bPLAIN\b/i.test(auth) || !/\bLOGIN\b/i.test(auth)) {
          await cmd(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass ?? ''}`).toString('base64')}`, [235], 'AUTH PLAIN');
        } else {
          await cmd('AUTH LOGIN', [334], 'AUTH LOGIN');
          await cmd(Buffer.from(user).toString('base64'), [334], 'AUTH LOGIN user');
          await cmd(Buffer.from(pass ?? '').toString('base64'), [235], 'AUTH LOGIN password');
        }
      }
      await cmd(`MAIL FROM:<${addressOf(msg.from)}>`, [250], 'MAIL FROM');
      const to = (Array.isArray(msg.to) ? msg.to : [msg.to]).filter(Boolean);
      for (const t of to) await cmd(`RCPT TO:<${addressOf(t)}>`, [250, 251], 'RCPT TO');
      await cmd('DATA', [354], 'DATA');
      const stuffed = raw.replace(/\r\n\./g, '\r\n..');
      socket.write(stuffed.endsWith('\r\n') ? stuffed : `${stuffed}\r\n`);
      await cmd('.', [250], 'message');
      try {
        await cmd('QUIT', [221], 'QUIT');
      } catch {
        /* the message is already accepted */
      }
      return { id };
    } finally {
      r.detach();
      socket.destroy();
    }
  }

  return { name: 'smtp', send };
}

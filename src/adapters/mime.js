// Builds one RFC 5322 message with MIME parts. Used by the SMTP mailer and the file outbox.
import crypto from 'node:crypto';

function encodeHeader(s) {
  const v = String(s ?? '');
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`;
}

function wrap76(b64) {
  return b64.replace(/.{1,76}/g, '$&\r\n').trimEnd();
}

/** The bare address inside "Name <addr>" or the string itself. */
export function addressOf(s) {
  const m = /<([^>]+)>/.exec(String(s));
  return (m ? m[1] : String(s)).trim();
}

function domainOf(s) {
  return addressOf(s).split('@')[1] || 'localhost';
}

function formatAddress(s) {
  const v = String(s).trim();
  const m = /^(.*)<([^>]+)>$/.exec(v);
  if (!m) return v;
  const name = m[1].trim().replace(/^"|"$/g, '');
  return name ? `${encodeHeader(name)} <${m[2].trim()}>` : `<${m[2].trim()}>`;
}

/**
 * buildMessage({ from, to, subject, text, html, attachments: [{ filename, content, contentType }] })
 * -> { id, raw } where raw uses CRLF line endings.
 */
export function buildMessage({ from, to, replyTo, subject, text = '', html = null, attachments = [], date = new Date() }) {
  const id = `<${crypto.randomUUID()}@${domainOf(from)}>`;
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  const headers = [
    `From: ${formatAddress(from)}`,
    `To: ${recipients.map(formatAddress).join(', ')}`,
    ...(replyTo ? [`Reply-To: ${formatAddress(replyTo)}`] : []),
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: ${id}`,
    'MIME-Version: 1.0',
  ];
  const textPart = ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', wrap76(Buffer.from(text, 'utf8').toString('base64'))].join('\r\n');
  const htmlPart = html ? ['Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', wrap76(Buffer.from(html, 'utf8').toString('base64'))].join('\r\n') : null;

  let body;
  let bodyType;
  if (htmlPart) {
    const alt = `alt-${crypto.randomBytes(8).toString('hex')}`;
    bodyType = `multipart/alternative; boundary="${alt}"`;
    body = [`--${alt}`, textPart, `--${alt}`, htmlPart, `--${alt}--`].join('\r\n');
  } else {
    bodyType = null;
    body = textPart;
  }

  if (!attachments.length) {
    if (bodyType) return { id, raw: [...headers, `Content-Type: ${bodyType}`, '', body, ''].join('\r\n') };
    return { id, raw: [...headers, body, ''].join('\r\n') };
  }

  const mixed = `mixed-${crypto.randomBytes(8).toString('hex')}`;
  const parts = [`--${mixed}`, bodyType ? `Content-Type: ${bodyType}\r\n\r\n${body}` : body];
  for (const a of attachments) {
    const content = Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content ?? '');
    const name = String(a.filename || 'attachment').replace(/["\r\n]/g, '');
    parts.push(
      `--${mixed}`,
      [`Content-Type: ${a.contentType || 'application/octet-stream'}; name="${name}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${name}"`, '', wrap76(content.toString('base64'))].join('\r\n'),
    );
  }
  parts.push(`--${mixed}--`);
  return { id, raw: [...headers, `Content-Type: multipart/mixed; boundary="${mixed}"`, '', parts.join('\r\n'), ''].join('\r\n') };
}

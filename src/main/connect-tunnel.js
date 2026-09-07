const net = require('net');

function parseConnect(header) {
  const line = header.toString('latin1').split('\r\n')[0];
  const match = /^CONNECT (\[[0-9a-fA-F:.]+\]|[a-zA-Z0-9._-]+):(\d{1,5}) HTTP\/1\.[01]$/.exec(line);
  if (!match) throw new Error('Invalid CONNECT request');
  const host = match[1].replace(/^\[|\]$/g, ''), port = Number(match[2]);
  if (port < 1 || port > 65535 || (match[1][0] === '[' && net.isIP(host) !== 6)) throw new Error('Invalid CONNECT target');
  return { host, port };
}

function handleConnect(client, { resolve, split, connect = net.connect, timeout = 10000 }) {
  let header = Buffer.alloc(0), upstream, timer;
  const kill = () => { clearTimeout(timer); client.destroy(); upstream?.destroy(); };
  client.on('error', kill);
  client.on('close', kill);
  timer = setTimeout(kill, timeout);
  const onHeader = async chunk => {
    header = Buffer.concat([header, chunk]);
    const end = header.indexOf('\r\n\r\n');
    if ((end < 0 && header.length > 16384) || end > 16384) { client.end('HTTP/1.1 431 Request Header Fields Too Large\r\n\r\n'); clearTimeout(timer); return; }
    if (end < 0) return;
    client.removeListener('data', onHeader);
    client.pause();
    let target;
    try { target = parseConnect(header.subarray(0, end)); }
    catch { clearTimeout(timer); client.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    const remainder = header.subarray(end + 4);
    header = null;
    try {
      const ip = await resolve(target.host);
      if (client.destroyed) return;
      upstream = connect({ host: ip || target.host, port: target.port });
      upstream.on('error', kill);
      upstream.on('close', kill);
      upstream.once('connect', () => {
        if (client.destroyed) return kill();
        clearTimeout(timer);
        upstream.setNoDelay(true);
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        upstream.pipe(client);
        // Consume exactly the first TLS chunk, then let pipe handle backpressure.
        const first = chunk => {
          const point = split(chunk);
          if (point > 0 && point < chunk.length) { upstream.write(chunk.subarray(0, point)); upstream.write(chunk.subarray(point)); }
          else upstream.write(chunk);
          client.pipe(upstream);
        };
        if (remainder.length) first(remainder);
        else client.once('data', first);
        client.resume();
      });
    } catch { kill(); }
  };
  client.on('data', onHeader);
  client.on('end', () => { clearTimeout(timer); upstream?.end(); });
}
module.exports = { parseConnect, handleConnect };

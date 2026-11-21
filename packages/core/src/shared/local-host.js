// What counts as this machine, for the local servers (review, dev server) and
// for publish. The local servers listen on 127.0.0.1 with no login. A web page
// can still point its own domain at 127.0.0.1 (DNS rebinding) and read them.
// Its requests carry that domain in the Host header, so a server bound to this
// machine answers only requests that name this machine.
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * True for a name of this machine: localhost, 127.0.0.1 or ::1 (with or without brackets).
 * @param {string | undefined} hostname a host name with no port
 */
export const isLoopback = (hostname) => LOOPBACK.has(String(hostname ?? "").toLowerCase());

/**
 * False when the server listens on this machine only and the Host header names
 * another host. A server bound to another host on purpose answers any name.
 * @param {string} listenHost the host the server listens on
 * @param {string | undefined} hostHeader the request's Host header, like localhost:4400
 */
export function hostAllowed(listenHost, hostHeader) {
  if (!isLoopback(listenHost)) return true;
  try {
    return isLoopback(new URL(`http://${hostHeader}`).hostname);
  } catch {
    return false;
  }
}

/** @param {string} listenHost @param {number} port */
export const wrongHostMessage = (listenHost, port) =>
  `This server answers only requests to localhost, 127.0.0.1 or [::1]. Open http://${listenHost}:${port}/ instead.`;

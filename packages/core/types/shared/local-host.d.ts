/**
 * True for a name of this machine: localhost, 127.0.0.1 or ::1 (with or without brackets).
 * @param {string | undefined} hostname a host name with no port
 */
export declare const isLoopback: (hostname: string | undefined) => boolean;
/**
 * False when the server listens on this machine only and the Host header names
 * another host. A server bound to another host on purpose answers any name.
 * @param {string} listenHost the host the server listens on
 * @param {string | undefined} hostHeader the request's Host header, like localhost:4400
 */
export declare function hostAllowed(listenHost: string, hostHeader: string | undefined): boolean;
/** @param {string} listenHost @param {number} port */
export declare const wrongHostMessage: (listenHost: string, port: number) => string;

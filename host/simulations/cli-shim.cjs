#!/usr/bin/env node
const net = require('node:net');
let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', part => input += part);
process.stdin.on('end', () => {
 const socket = net.connect(process.env.SIMULATION_RPC_SOCKET); let response = '';
 socket.on('connect', () => socket.end(JSON.stringify({ token: process.env.SIMULATION_RPC_TOKEN, argv: process.argv.slice(2), input }) + '\n'));
 socket.on('data', data => response += data); socket.on('error', error => { process.stderr.write(error.message + '\n'); process.exitCode = 1 });
 socket.on('end', () => { try { const reply = JSON.parse(response); if (!reply.ok) { process.stderr.write(reply.error + '\n'); process.exitCode = 1 } else process.stdout.write(JSON.stringify(reply.receipt) + '\n') } catch { process.stderr.write('Simulation CLI returned no valid receipt.\n'); process.exitCode = 1 } });
});

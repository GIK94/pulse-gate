#!/usr/bin/env node
// Prints fresh production-grade secrets for PulseGate. Store them in your secret manager, never in git.
import { randomBytes } from 'node:crypto';

const keyId = `k${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
console.log(`API_KEY_PEPPER=${randomBytes(32).toString('base64url')}`);
console.log(`ENCRYPTION_KEYS=${keyId}:${randomBytes(32).toString('base64')}`);

import assert from 'node:assert/strict';
import test from 'node:test';

import * as jsonrpc from '../adapters/jsonrpc.js';
import { apiCache } from '../utils/cache.js';

const ADDRESS = '0x1234567890123456789012345678901234567890';

function reply(request: { id: number }, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('switching RPC nodes cannot return a balance cached from the previous node', async (t) => {
  apiCache.clear();
  let balanceCalls = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { id: number; method: string };
    if (request.method === 'eth_chainId') return reply(request, '0x1');
    if (request.method === 'eth_blockNumber') return reply(request, '0x1');
    if (request.method === 'eth_getBalance') {
      balanceCalls++;
      return reply(
        request,
        String(input).includes(':8545') ? '0xde0b6b3a7640000' : '0x1bc16d674ec80000'
      );
    }
    throw new Error(`Unexpected RPC method: ${request.method}`);
  });

  await jsonrpc.setNodeUrl('http://localhost:8545');
  assert.equal(await jsonrpc.getBalance(ADDRESS), '1.000000');
  await jsonrpc.setNodeUrl('http://localhost:8546');
  assert.equal(await jsonrpc.getBalance(ADDRESS), '2.000000');
  assert.equal(balanceCalls, 2);
});

test('different log topic filters cannot return the same cached results', async (t) => {
  apiCache.clear();
  let logCalls = 0;
  t.mock.method(globalThis, 'fetch', async (_input: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params: Array<{ topics: string[] }>;
    };
    if (request.method === 'eth_chainId') return reply(request, '0x1');
    if (request.method === 'eth_blockNumber') return reply(request, '0x1');
    if (request.method === 'eth_getLogs') {
      logCalls++;
      return reply(request, [{ topic: request.params[0].topics[1] }]);
    }
    throw new Error(`Unexpected RPC method: ${request.method}`);
  });

  await jsonrpc.setNodeUrl('http://localhost:8545');
  const first = await jsonrpc.getLogs(ADDRESS, 10, 12, '0xaa', '0x01');
  const second = await jsonrpc.getLogs(ADDRESS, 10, 12, '0xaa', '0x02');
  assert.deepEqual(first, [{ topic: '0x01' }]);
  assert.deepEqual(second, [{ topic: '0x02' }]);
  assert.equal(logCalls, 2);
});

test('gas estimates include the transaction value in the cache identity', async (t) => {
  apiCache.clear();
  let estimateCalls = 0;
  t.mock.method(globalThis, 'fetch', async (_input: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params: Array<{ value: string }>;
    };
    if (request.method === 'eth_chainId') return reply(request, '0x1');
    if (request.method === 'eth_blockNumber') return reply(request, '0x1');
    if (request.method === 'eth_estimateGas') {
      estimateCalls++;
      return reply(request, request.params[0].value === '0x0' ? '0x5208' : '0x7530');
    }
    throw new Error(`Unexpected RPC method: ${request.method}`);
  });

  await jsonrpc.setNodeUrl('http://localhost:8545');
  assert.equal(await jsonrpc.estimateGas(ADDRESS, '0x', '0x0'), '0x5208');
  assert.equal(await jsonrpc.estimateGas(ADDRESS, '0x', '0x1'), '0x7530');
  assert.equal(estimateCalls, 2);
});

test('repeated identical RPC requests still use the cache', async (t) => {
  apiCache.clear();
  let balanceCalls = 0;
  t.mock.method(globalThis, 'fetch', async (_input: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { id: number; method: string };
    if (request.method === 'eth_chainId') return reply(request, '0x1');
    if (request.method === 'eth_blockNumber') return reply(request, '0x1');
    if (request.method === 'eth_getBalance') {
      balanceCalls++;
      return reply(request, '0xde0b6b3a7640000');
    }
    throw new Error(`Unexpected RPC method: ${request.method}`);
  });

  await jsonrpc.setNodeUrl('http://localhost:8545');
  assert.equal(await jsonrpc.getBalance(ADDRESS), '1.000000');
  assert.equal(await jsonrpc.getBalance(ADDRESS), '1.000000');
  assert.equal(balanceCalls, 1);
});

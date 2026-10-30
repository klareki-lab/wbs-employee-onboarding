import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseRpcResponse} from './mcp.mjs';
const response={jsonrpc:'2.0',id:1,result:{executionId:'42'}};
test('JSON response',()=>assert.deepEqual(parseRpcResponse(' '+JSON.stringify(response)),response));
test('SSE keepalive before result',()=>assert.deepEqual(parseRpcResponse(': keepalive\r\n\r\nevent: message\r\ndata: '+JSON.stringify(response)+'\r\n\r\n'),response));
test('SSE notifications skipped, multiline data supported',()=>assert.deepEqual(parseRpcResponse('data: {"jsonrpc":"2.0","method":"notifications/progress"}\n\ndata: {"jsonrpc":"2.0",\ndata: "id":1,"result":{"executionId":"42"}}\n\n'),response));
test('missing response fails explicitly',()=>assert.throws(()=>parseRpcResponse(': keepalive\n\n'),/Keine passende/));
test('JSON RPC error preserved',()=>assert.deepEqual(parseRpcResponse('data: {"id":1,"error":{"code":-1}}\n\n'),{id:1,error:{code:-1}}));

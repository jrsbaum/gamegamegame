import test from 'node:test';
import assert from 'node:assert/strict';
import { taskBubbleText } from '../web/bubbles.mjs';

test('BUBBLE-03: privacy projection maps to the intended speech bubble', () => {
  assert.equal(taskBubbleText({ status: 'working' }), 'Trabalhando');
  assert.equal(taskBubbleText({ status: 'working', title: 'Revisar o painel' }), 'Revisar o painel');
  assert.equal(taskBubbleText({ status: 'working', title: 'Revisar o painel', description: 'Conferir os estados.' }), 'Trabalhando · Revisar o painel');
  assert.equal(taskBubbleText({ status: 'waiting', title: 'x'.repeat(80), description: 'contexto' }).length <= 40, true);
});

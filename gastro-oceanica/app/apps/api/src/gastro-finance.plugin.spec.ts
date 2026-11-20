import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gastroFinancePlugin } from './gastro-finance.plugin';

test('Gastro finance exposes read-only synthetic examples only to simulated profiles with read permission', () => {
  const examples = gastroFinancePlugin.contributions?.profileSimulationExamples;
  assert.ok(examples);
  assert.deepEqual(examples({ roleId: 'role-no-finance', roleName: 'Perfil sem financeiro', permissions: [] }), []);
  const visible = examples({ roleId: 'finance-reader', roleName: 'Leitor financeiro', permissions: ['plugin.gastro-finance.read'] });
  assert.equal(visible.length, 2);
  assert.ok(visible.every(item => item.is_demo === true && item.description.includes('fictícios') && item.description.includes('somente leitura')));
  assert.ok(visible.every(item => !/paciente|cpf|telefone|email/i.test(`${item.title} ${item.description}`)));
});

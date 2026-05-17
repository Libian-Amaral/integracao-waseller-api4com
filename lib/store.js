// =====================================================================
//  Armazenamento dos leads.
//
//  Para um volume moderado de leads, guardar em um arquivo JSON e
//  suficiente e simples. As funcoes abaixo foram escritas de forma que,
//  se um dia o volume crescer muito, da para trocar so este arquivo por
//  um banco de dados sem mexer no resto do projeto.
//
//  IMPORTANTE: em hospedagens gratuitas (como o plano free do Render) o
//  disco e "efemero" - o arquivo pode ser zerado quando o servico
//  reinicia. Isso nao quebra a integracao: os leads voltam a aparecer
//  conforme o WaSeller dispara novos webhooks. Para manter o historico,
//  use um disco persistente (veja o README).
// =====================================================================

const fs = require('fs');
const path = require('path');

const ARQUIVO = process.env.DATA_FILE
  ? path.resolve(process.env.DATA_FILE)
  : path.join(__dirname, '..', 'data', 'leads.json');

function garantirArquivo() {
  const dir = path.dirname(ARQUIVO);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(ARQUIVO)) fs.writeFileSync(ARQUIVO, '{}', 'utf8');
}

function lerTudo() {
  garantirArquivo();
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')) || {};
  } catch (e) {
    console.error('[store] Erro ao ler o arquivo de dados:', e.message);
    return {};
  }
}

function salvarTudo(dados) {
  garantirArquivo();
  fs.writeFileSync(ARQUIVO, JSON.stringify(dados, null, 2), 'utf8');
}

// Cria ou atualiza um lead. A chave e o waId (numero so com digitos).
function salvarLead(lead) {
  const dados = lerTudo();
  const existente = dados[lead.waId] || {};
  dados[lead.waId] = {
    ...existente,
    ...lead,
    criadoEm: existente.criadoEm || new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
  };
  salvarTudo(dados);
  return dados[lead.waId];
}

function obterLead(waId) {
  return lerTudo()[waId] || null;
}

// Lista os leads, do mais recente para o mais antigo.
function listarLeads() {
  const dados = lerTudo();
  return Object.values(dados).sort(
    (a, b) => new Date(b.criadoEm) - new Date(a.criadoEm)
  );
}

function atualizarLead(waId, campos) {
  const dados = lerTudo();
  if (!dados[waId]) return null;
  dados[waId] = {
    ...dados[waId],
    ...campos,
    atualizadoEm: new Date().toISOString(),
  };
  salvarTudo(dados);
  return dados[waId];
}

module.exports = { salvarLead, obterLead, listarLeads, atualizarLead };

// =====================================================================
//  Cliente da API de voz da API4COM.
//  Documentacao oficial: https://developers.api4com.com
//
//  Autenticacao: o token vai no cabecalho "Authorization" de cada
//  requisicao (conforme a pagina de Autenticacao da documentacao).
// =====================================================================

const BASE_URL = 'https://api.api4com.com/api/v1';
const TIMEOUT_MS = 20000; // tempo-limite das chamadas HTTP

function getToken() {
  const token = process.env.API4COM_TOKEN;
  if (!token) throw new Error('API4COM_TOKEN nao configurado no .env');
  return token;
}

// Chamada HTTP base autenticada pelo token do ambiente.
async function chamar(metodo, rota, corpo) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(BASE_URL + rota, {
      method: metodo,
      headers: {
        'Content-Type': 'application/json',
        Authorization: getToken(),
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`API4COM ${metodo} ${rota} excedeu o tempo-limite (${TIMEOUT_MS} ms).`);
    throw new Error(`API4COM ${metodo} ${rota} falhou: ${e.message}`);
  } finally { clearTimeout(timer); }

  const texto = await resp.text();
  let dados;
  try { dados = texto ? JSON.parse(texto) : {}; } catch { dados = { raw: texto }; }
  if (!resp.ok) {
    const erro = new Error(`API4COM ${metodo} ${rota} falhou (HTTP ${resp.status}): ${texto}`);
    erro.status = resp.status;
    throw erro;
  }
  return dados;
}

// Dispara uma ligacao (POST /dialer).
async function realizarChamada({ extension, phone, metadata }) {
  return chamar('POST', '/dialer', { extension, phone, metadata: metadata || {} });
}

// Consulta o estado atual de uma chamada (GET /channels/:id).
// Usado pelo polling do server.js quando o webhook de fim nao chega.
// Retorna objeto com pelo menos: endedAt, duration, hangupCause, recordUrl (quando termina).
async function obterStatusChamada(callId) {
  return chamar('GET', `/channels/${encodeURIComponent(callId)}`);
}

// Cria/atualiza a integracao que faz a API4COM enviar o webhook de fim
// de chamada para o nosso servico (PATCH /integrations).
async function registrarWebhook({ gateway, webhookUrl }) {
  return chamar('PATCH', '/integrations', {
    gateway,
    webhook: true,
    webhookConstraint: { metadata: { gateway } },
    metadata: {
      webhookUrl,
      webhookVersion: '1.8',
      webhookTypes: ['channel-answer', 'channel-hangup'],
    },
  });
}

// ---------------------------------------------------------------------
//  Gera um token de acesso PERMANENTE da API4COM a partir do e-mail e
//  da senha do usuario. Usado pela pagina /admin para a configuracao
//  inicial sem precisar de Node.js local.
//
//  Faz dois passos, conforme a documentacao de Autenticacao:
//   1) POST /users/login        -> token temporario
//   2) POST /users/accessTokens -> token permanente (ttl: -1)
// ---------------------------------------------------------------------
async function gerarTokenPermanente({ email, password }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // 1) login
    const r1 = await fetch(BASE_URL + '/users/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: controller.signal,
    });
    const t1 = await r1.text();
    let d1; try { d1 = t1 ? JSON.parse(t1) : {}; } catch { d1 = { raw: t1 }; }
    if (!r1.ok) throw new Error(`Login API4COM falhou (HTTP ${r1.status}): ${t1}`);
    if (!d1.id) throw new Error('A API4COM nao retornou o token de login.');

    // 2) cria token permanente
    const r2 = await fetch(BASE_URL + '/users/accessTokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: d1.id },
      body: JSON.stringify({ ttl: -1 }),
      signal: controller.signal,
    });
    const t2 = await r2.text();
    let d2; try { d2 = t2 ? JSON.parse(t2) : {}; } catch { d2 = { raw: t2 }; }
    if (!r2.ok) throw new Error(`Criar token permanente falhou (HTTP ${r2.status}): ${t2}`);
    if (!d2.id) throw new Error('A API4COM nao retornou o token permanente.');

    return { token: d2.id };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`API4COM excedeu o tempo-limite (${TIMEOUT_MS} ms).`);
    throw e;
  } finally { clearTimeout(timer); }
}

module.exports = { realizarChamada, obterStatusChamada, registrarWebhook, gerarTokenPermanente };

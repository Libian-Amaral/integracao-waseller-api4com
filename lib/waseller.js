// =====================================================================
//  Cliente da API do WaSeller (Wascript API).
//  Documentacao oficial: https://api-whatsapp.wascript.com.br/api-docs/
//
//  Autenticacao: o token vai no FINAL da URL (parametro de rota),
//  no formato  /api/{rota}/{token}
//
//  IMPORTANTE: a API do WaSeller depende do WhatsApp Web estar aberto e
//  conectado no computador onde o WaSeller roda. Se estiver fechado, a
//  API responde com erro 501 ("Pagina do Whatsapp nao aberta ou API
//  desconectada"). Veja o README.
// =====================================================================

const BASE_URL = 'https://api-whatsapp.wascript.com.br';
const TIMEOUT_MS = 20000; // tempo-limite das chamadas HTTP

function getToken() {
  const token = process.env.WASELLER_TOKEN;
  if (!token) throw new Error('WASELLER_TOKEN nao configurado no .env');
  return token;
}

async function chamar(metodo, rota, corpo) {
  const url = `${BASE_URL}${rota}/${encodeURIComponent(getToken())}`;

  // AbortController garante que a requisicao nao fique presa para sempre
  // se a API do WaSeller estiver lenta ou fora do ar.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let resp;
  try {
    resp = await fetch(url, {
      method: metodo,
      headers: { 'Content-Type': 'application/json' },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(
        `WaSeller ${metodo} ${rota} excedeu o tempo-limite (${TIMEOUT_MS} ms).`
      );
    }
    throw new Error(`WaSeller ${metodo} ${rota} falhou: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }

  const texto = await resp.text();
  let dados;
  try {
    dados = texto ? JSON.parse(texto) : {};
  } catch {
    dados = { raw: texto };
  }

  if (!resp.ok) {
    const erro = new Error(
      `WaSeller ${metodo} ${rota} falhou (HTTP ${resp.status}): ${texto}`
    );
    erro.status = resp.status;
    throw erro;
  }
  return dados;
}

// ---------------------------------------------------------------------
//  Cria uma nota no contato do WaSeller (POST /api/criar-nota/{token}).
//  Corpo conforme a documentacao: { userID, text }
//  - userID: numero do contato (so digitos, ex: "5511999999999")
//  - text:   conteudo da nota
// ---------------------------------------------------------------------
async function criarNota({ userID, text }) {
  return chamar('POST', '/api/criar-nota', { userID, text });
}

// ---------------------------------------------------------------------
//  Adiciona/remove etiquetas de um ou mais contatos
//  (POST /api/modificar-etiquetas/{token}).
//  Corpo conforme a documentacao:
//    { phone: ["55..."], actions: [{ labelId: "1", type: "add" }] }
// ---------------------------------------------------------------------
async function modificarEtiquetas({ phone, actions }) {
  return chamar('POST', '/api/modificar-etiquetas', {
    phone: Array.isArray(phone) ? phone : [phone],
    actions,
  });
}

// ---------------------------------------------------------------------
//  Lista as etiquetas disponiveis (GET /api/listar-etiquetas/{token}).
//  Util para descobrir os labelId que vao no .env.
// ---------------------------------------------------------------------
async function listarEtiquetas() {
  return chamar('GET', '/api/listar-etiquetas');
}

module.exports = { criarNota, modificarEtiquetas, listarEtiquetas };
